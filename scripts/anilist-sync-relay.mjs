// Runs OUTSIDE Cloudflare on purpose — same reason as scripts/refresh-anilist-cache.mjs:
// AniList has manually blocked Cloudflare Workers' IP ranges (confirmed via
// a 403 "manually blocked" response on graphql.anilist.co), so the Worker
// can never talk to AniList's GraphQL API directly. This script does that
// talking from GitHub's runners instead, and reads/writes D1 directly over
// Cloudflare's REST API — the Worker only ever sets a "please sync me" flag
// (anilist_sync_pending_pull) or queues a row (anilist_push_queue); this
// script is what actually does the AniList side of the work.
//
// Required env vars (set as GitHub repo secrets — reuses the same
// CF_API_TOKEN / CF_ACCOUNT_ID already used by refresh-anilist-cache.mjs;
// that token needs "D1: Edit" permission added if it doesn't have it):
//   CF_API_TOKEN   - Cloudflare API token with D1 Edit permission
//   CF_ACCOUNT_ID  - Cloudflare account ID
//
// The D1 database ID is NOT a secret (it's already committed in
// wrangler.toml), so it's hardcoded below rather than needing its own
// GitHub secret.

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_D1_DATABASE_ID = 'd81c4c7f-74c1-413f-ac90-30ac305415b6'; // see wrangler.toml [[d1_databases]]

if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
  console.error('Missing one of CF_API_TOKEN / CF_ACCOUNT_ID env vars.');
  process.exit(1);
}

const ANILIST_STATUS_TO_LOCAL = {
  CURRENT: 'watching', REPEATING: 'watching', PLANNING: 'plan_to_watch',
  COMPLETED: 'completed', DROPPED: 'dropped', PAUSED: 'on_hold',
};
const LOCAL_STATUS_TO_ANILIST = {
  watching: 'CURRENT', plan_to_watch: 'PLANNING', completed: 'COMPLETED', dropped: 'DROPPED', on_hold: 'PAUSED',
};

// ── D1 REST helper ──────────────────────────────────────────────────────
async function d1(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors ?? json).slice(0, 500)}`);
  return json.result?.[0]?.results ?? [];
}

// ── AniList GraphQL helper ──────────────────────────────────────────────
async function anilistGraphQL(token, query, variables) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { ok: res.status === 200 && json && !json.errors, status: res.status, json };
}

// ── Step 1: process accounts waiting for their initial username+list pull ──
async function processPendingPulls() {
  const users = await d1(
    `SELECT id, anilist_sync_access_token FROM users WHERE anilist_sync_pending_pull = 1 AND anilist_sync_access_token IS NOT NULL LIMIT 15`
  );
  console.log(`[pull] ${users.length} account(s) awaiting initial AniList sync.`);

  for (const user of users) {
    const userId = user.id;
    const token = user.anilist_sync_access_token;

    const viewerRes = await anilistGraphQL(token, `query { Viewer { id name } }`, {});
    if (!viewerRes.ok) {
      console.log(`[pull] user ${userId}: Viewer query failed (HTTP ${viewerRes.status}) — token likely invalid, disconnecting.`);
      await d1(`UPDATE users SET anilist_sync_username=NULL, anilist_sync_user_id=NULL, anilist_sync_access_token=NULL, anilist_sync_token_expires=NULL, anilist_sync_pending_pull=0 WHERE id=?`, [userId]);
      continue;
    }
    const viewer = viewerRes.json.data.Viewer;

    const listQuery = `
      query ($userId: Int) {
        MediaListCollection(userId: $userId, type: ANIME) {
          lists { entries { status score(format: POINT_10) progress media { idMal title { romaji english } coverImage { large medium } } } }
        }
      }`;
    const listRes = await anilistGraphQL(token, listQuery, { userId: viewer.id });
    const lists = listRes.ok ? (listRes.json.data?.MediaListCollection?.lists ?? []) : [];

    let added = 0;
    for (const list of lists) {
      for (const entry of list.entries ?? []) {
        const animeId = Number(entry.media?.idMal ?? 0);
        const status = ANILIST_STATUS_TO_LOCAL[entry.status];
        if (!animeId || !status) continue;

        const exists = await d1('SELECT id FROM anime_list WHERE user_id=? AND anime_id=?', [userId, animeId]);
        if (exists.length) continue;

        const localImg = await d1('SELECT image_url FROM anime_images WHERE anime_id=?', [animeId]);
        const image = localImg[0]?.image_url || entry.media?.coverImage?.large || entry.media?.coverImage?.medium || '';
        const title = entry.media?.title?.english || entry.media?.title?.romaji || '';

        await d1(
          `INSERT INTO anime_list (user_id, anime_id, anime_title, anime_image, status, episodes_watched, score, updated_at) VALUES (?,?,?,?,?,?,?,datetime('now'))`,
          [userId, animeId, title, image, status, Number(entry.progress ?? 0), entry.score ? Number(entry.score) : null]
        );
        added++;
      }
    }

    await d1(`UPDATE users SET anilist_sync_username=?, anilist_sync_user_id=?, anilist_sync_pending_pull=0 WHERE id=?`, [viewer.name, viewer.id, userId]);
    console.log(`[pull] user ${userId}: connected as ${viewer.name}, imported ${added} new anime.`);
  }
}

// ── Step 2: process queued pushes (local edits waiting to reach AniList) ──
async function processPushQueue() {
  const rows = await d1(
    `SELECT q.id as queue_id, q.user_id, q.anime_id, q.status, q.episodes_watched, q.score, q.attempts, u.anilist_sync_access_token as token
     FROM anilist_push_queue q JOIN users u ON u.id = q.user_id
     WHERE u.anilist_sync_access_token IS NOT NULL LIMIT 50`
  );
  console.log(`[push] ${rows.length} queued update(s).`);

  for (const row of rows) {
    const aniStatus = LOCAL_STATUS_TO_ANILIST[row.status];
    if (!aniStatus) { await d1('DELETE FROM anilist_push_queue WHERE id=?', [row.queue_id]); continue; }

    const lookup = await anilistGraphQL(row.token, `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id } }`, { idMal: row.anime_id });
    const mediaId = lookup.ok ? lookup.json.data?.Media?.id : null;

    let pushed = false;
    if (mediaId) {
      const mutation = `
        mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) { id }
        }`;
      const saveRes = await anilistGraphQL(row.token, mutation, { mediaId, status: aniStatus, progress: row.episodes_watched, score: row.score ?? undefined });
      pushed = saveRes.ok;
    }

    if (pushed) {
      await d1('DELETE FROM anilist_push_queue WHERE id=?', [row.queue_id]);
    } else {
      const attempts = Number(row.attempts ?? 0) + 1;
      if (attempts >= 5) {
        console.log(`[push] queue #${row.queue_id}: giving up after ${attempts} attempts.`);
        await d1('DELETE FROM anilist_push_queue WHERE id=?', [row.queue_id]);
      } else {
        await d1('UPDATE anilist_push_queue SET attempts=? WHERE id=?', [attempts, row.queue_id]);
      }
    }
  }
}

await processPendingPulls();
await processPushQueue();
console.log('Done.');
