// Ports admin/merge_users.php + admin/merge_users_search.php.
import { Hono } from 'hono';
import type { Env } from '../../index';
import { buildAdminCtx } from '../../lib/admin-ctx';
import { Logger } from '../../lib/logger';
import { OWNER_USER_ID } from '../../lib/auth';
import { h } from '../../lib/helpers';
import { renderAdminHeader, renderAdminFooter } from '../../render/admin-layout';

export const adminMergeUsersRoutes = new Hono<{ Bindings: Env }>();

const MERGE_TABLES_UNIQUE: Record<string, string> = { anime_list: 'anime_id', favorites: 'anime_id' };
const MERGE_TABLES_PLAIN = ['activity_log'];

adminMergeUsersRoutes.on(['GET', 'POST'], '/admin/merge_users.php', async (c) => {
  const ctx = await buildAdminCtx(c);
  const siteUrl = c.env.SITE_URL;
  if (!ctx) return c.redirect(siteUrl + '/');
  const { db, session, lifetime, isOwner, impersonating, userId } = ctx;

  if (!isOwner) {
    session.setFlash('error', 'Only the Owner can merge accounts.');
    await session.save(c, lifetime);
    return c.redirect(`${siteUrl}/admin/users.php`);
  }

  if (c.req.method === 'POST') {
    const body = await c.req.parseBody();
    const keepId = parseInt((body.keep_id as string) ?? '0', 10) || 0;
    const mergeId = parseInt((body.merge_id as string) ?? '0', 10) || 0;

    if (!keepId || !mergeId) { session.setFlash('error', 'Both users must be selected.'); }
    else if (keepId === mergeId) { session.setFlash('error', 'Cannot merge a user with themselves.'); }
    else if (mergeId === OWNER_USER_ID) { session.setFlash('error', 'Cannot merge the Owner account away.'); }
    else {
      const keepUser = await db.fetchOne<{ id: number; username: string }>('SELECT * FROM users WHERE id=?', [keepId]);
      const mergeUser = await db.fetchOne<{ id: number; username: string }>('SELECT * FROM users WHERE id=?', [mergeId]);
      if (!keepUser || !mergeUser) {
        session.setFlash('error', 'One or both users not found.');
      } else {
        for (const [table, uniqueCol] of Object.entries(MERGE_TABLES_UNIQUE)) {
          const existing = await db.fetchAll<any>(`SELECT ${uniqueCol} FROM ${table} WHERE user_id=?`, [keepId]);
          const existingIds = new Set(existing.map((r) => r[uniqueCol]));
          const rows = await db.fetchAll<any>(`SELECT * FROM ${table} WHERE user_id=?`, [mergeId]);
          for (const row of rows) {
            if (!existingIds.has(row[uniqueCol])) {
              await db.query(`UPDATE ${table} SET user_id=? WHERE user_id=? AND ${uniqueCol}=?`, [keepId, mergeId, row[uniqueCol]]);
            }
          }
          await db.query(`DELETE FROM ${table} WHERE user_id=?`, [mergeId]);
        }
        for (const table of MERGE_TABLES_PLAIN) {
          await db.query(`UPDATE ${table} SET user_id=? WHERE user_id=?`, [keepId, mergeId]);
        }
        // Preserve community relationships before deleting the source account.
        // A merged account must not leave follower/following references behind.
        await db.query(
          `INSERT OR IGNORE INTO follows (follower_id, following_id)
           SELECT CASE WHEN follower_id=? THEN ? ELSE follower_id END,
                  CASE WHEN following_id=? THEN ? ELSE following_id END
           FROM follows
           WHERE (follower_id=? OR following_id=?)
             AND CASE WHEN follower_id=? THEN ? ELSE follower_id END
                 != CASE WHEN following_id=? THEN ? ELSE following_id END`,
          [mergeId, keepId, mergeId, keepId, mergeId, mergeId, mergeId, keepId, mergeId, keepId]
        );
        await db.query('DELETE FROM follows WHERE follower_id=? OR following_id=?', [mergeId, mergeId]);

        // Move non-unique user-owned records and ownership references.
        await db.query('UPDATE chat_messages SET user_id=? WHERE user_id=?', [keepId, mergeId]);
        await db.query('UPDATE feedback SET user_id=? WHERE user_id=?', [keepId, mergeId]);
        await db.query('UPDATE survey_responses SET user_id=? WHERE user_id=?', [keepId, mergeId]);
        await db.query('UPDATE surveys SET created_by=? WHERE created_by=?', [keepId, mergeId]);

        // Ephemeral single-row-per-user state: keep the target's row when it exists.
        await db.query('DELETE FROM chat_presence WHERE user_id=? AND EXISTS (SELECT 1 FROM chat_presence WHERE user_id=?)', [mergeId, keepId]);
        await db.query('UPDATE chat_presence SET user_id=? WHERE user_id=?', [keepId, mergeId]);
        await db.query(
          'UPDATE chat_reads SET last_read_id=MAX(last_read_id, (SELECT last_read_id FROM chat_reads WHERE user_id=?)) WHERE user_id=? AND EXISTS (SELECT 1 FROM chat_reads WHERE user_id=?)',
          [mergeId, keepId, mergeId]
        );
        await db.query('DELETE FROM chat_reads WHERE user_id=? AND EXISTS (SELECT 1 FROM chat_reads WHERE user_id=?)', [mergeId, keepId]);
        await db.query('UPDATE chat_reads SET user_id=? WHERE user_id=?', [keepId, mergeId]);

        // Keep reactions from both accounts without duplicating the same reaction.
        await db.query(
          `DELETE FROM chat_reactions
           WHERE user_id=? AND EXISTS (
             SELECT 1 FROM chat_reactions target
             WHERE target.user_id=? AND target.message_id=chat_reactions.message_id
               AND target.emoji=chat_reactions.emoji
           )`,
          [mergeId, keepId]
        );
        await db.query('UPDATE chat_reactions SET user_id=? WHERE user_id=?', [keepId, mergeId]);

        // Merge points balances instead of letting ON DELETE CASCADE discard them.
        await db.query(
          `INSERT INTO points_wallets (user_id, balance, lifetime_earned, lifetime_spent, updated_at)
           SELECT ?, balance, lifetime_earned, lifetime_spent, updated_at
           FROM points_wallets WHERE user_id=?
           ON CONFLICT(user_id) DO UPDATE SET
             balance=points_wallets.balance+excluded.balance,
             lifetime_earned=points_wallets.lifetime_earned+excluded.lifetime_earned,
             lifetime_spent=points_wallets.lifetime_spent+excluded.lifetime_spent,
             updated_at=MAX(points_wallets.updated_at, excluded.updated_at)`,
          [keepId, mergeId]
        );
        await db.query('DELETE FROM points_wallets WHERE user_id=?', [mergeId]);
        // Ledger event keys are idempotency keys; retain one row per event key.
        await db.query(
          'DELETE FROM points_ledger WHERE user_id=? AND event_key IN (SELECT event_key FROM points_ledger WHERE user_id=?)',
          [mergeId, keepId]
        );
        await db.query('UPDATE points_ledger SET user_id=? WHERE user_id=?', [keepId, mergeId]);

        await db.query(
          `INSERT OR IGNORE INTO points_daily_claims (user_id, task_key, claim_date, points, created_at)
           SELECT ?, task_key, claim_date, points, created_at FROM points_daily_claims WHERE user_id=?`,
          [keepId, mergeId]
        );
        await db.query('DELETE FROM points_daily_claims WHERE user_id=?', [mergeId]);

        await db.query(
          `INSERT OR IGNORE INTO points_inventory (user_id, item_id, purchased_at, equipped)
           SELECT ?, item_id, purchased_at, equipped FROM points_inventory WHERE user_id=?`,
          [keepId, mergeId]
        );
        await db.query('DELETE FROM points_inventory WHERE user_id=?', [mergeId]);

        await db.query(
          `INSERT INTO points_watch_sessions (user_id, anime_id, episode_num, last_position, watched_seconds, last_seen_at, rewarded)
           SELECT ?, anime_id, episode_num, last_position, watched_seconds, last_seen_at, rewarded
           FROM points_watch_sessions WHERE user_id=?
           ON CONFLICT(user_id, anime_id, episode_num) DO UPDATE SET
             last_position=MAX(points_watch_sessions.last_position, excluded.last_position),
             watched_seconds=MAX(points_watch_sessions.watched_seconds, excluded.watched_seconds),
             last_seen_at=MAX(points_watch_sessions.last_seen_at, excluded.last_seen_at),
             rewarded=MAX(points_watch_sessions.rewarded, excluded.rewarded)`,
          [keepId, mergeId]
        );
        await db.query('DELETE FROM points_watch_sessions WHERE user_id=?', [mergeId]);

        await db.query(
          `INSERT INTO anime_watch_history (user_id, activity_date, episodes_watched, updated_at)
           SELECT ?, activity_date, episodes_watched, updated_at FROM anime_watch_history WHERE user_id=?
           ON CONFLICT(user_id, activity_date) DO UPDATE SET
             episodes_watched=anime_watch_history.episodes_watched+excluded.episodes_watched,
             updated_at=MAX(anime_watch_history.updated_at, excluded.updated_at)`,
          [keepId, mergeId]
        );
        await db.query('DELETE FROM anime_watch_history WHERE user_id=?', [mergeId]);

        // Keep the target's cosmetic/banner preferences if already configured.
        await db.query('DELETE FROM user_cosmetic_settings WHERE user_id=? AND EXISTS (SELECT 1 FROM user_cosmetic_settings WHERE user_id=?)', [mergeId, keepId]);
        await db.query('UPDATE user_cosmetic_settings SET user_id=? WHERE user_id=?', [keepId, mergeId]);

        await db.query('DELETE FROM users WHERE id=?', [mergeId]);
        await Logger.log(db, userId, 'owner_merge_users', `Merged user #${mergeId} (${mergeUser.username}) into #${keepId} (${keepUser.username})`);
        session.setFlash('success', `Merged "${mergeUser.username}" into "${keepUser.username}" successfully. The merged account has been deleted.`);
      }
    }
    await session.save(c, lifetime);
    return c.redirect(`${siteUrl}/admin/merge_users.php`);
  }

  const flash = session.takeFlash();
  const err = flash?.type === 'error' ? flash.message : null;
  const suc = flash?.type === 'success' ? flash.message : null;

  let html = renderAdminHeader({ siteUrl, pageTitle: 'Merge Accounts', adminPage: 'merge_users', isOwner, impersonating });
  html += `
<div class="admin-header"><h1>🔀 Merge Accounts</h1><span class="text-muted">Owner only — combine two accounts into one</span></div>
${err ? `<div class="alert alert-error mb-2">⚠️ ${h(err)}</div>` : ''}
${suc ? `<div class="alert alert-success mb-2">✅ ${h(suc)}</div>` : ''}

<div class="alert alert-error mb-3">⚠️ <strong>Warning:</strong> Merging is permanent. The "merge from" account will be <strong>deleted</strong>. Anime lists and favorites that don't conflict will be moved to the "keep" account.</div>

<div class="card card-body">
  <form method="POST" id="merge-form" onsubmit="return confirmMerge()">
    <div class="grid-2" style="gap:1.5rem;margin-bottom:1.5rem;">
      <div>
        <h3 style="margin-bottom:0.75rem;color:var(--color-success,#4caf50);">✅ Keep This Account</h3>
        <input type="text" class="form-control mb-1" placeholder="Search by username or email..." oninput="searchUser(this.value, 'keep')" style="width:100%;">
        <div id="keep-results" style="margin-bottom:0.75rem;"></div>
        <div id="keep-preview" style="display:none;background:rgba(76,175,80,0.08);border:1px solid rgba(76,175,80,0.3);border-radius:8px;padding:1rem;">
          <strong>Keeping:</strong> <span id="keep-name"></span><div class="text-muted" style="font-size:0.82rem;" id="keep-email"></div>
        </div>
        <input type="hidden" name="keep_id" id="keep-id-input">
      </div>
      <div>
        <h3 style="margin-bottom:0.75rem;color:#f44336;">🗑️ Merge &amp; Delete This Account</h3>
        <input type="text" class="form-control mb-1" placeholder="Search by username or email..." oninput="searchUser(this.value, 'merge')" style="width:100%;">
        <div id="merge-results" style="margin-bottom:0.75rem;"></div>
        <div id="merge-preview" style="display:none;background:rgba(244,67,54,0.08);border:1px solid rgba(244,67,54,0.3);border-radius:8px;padding:1rem;">
          <strong>Deleting:</strong> <span id="merge-name"></span><div class="text-muted" style="font-size:0.82rem;" id="merge-email"></div>
        </div>
        <input type="hidden" name="merge_id" id="merge-id-input">
      </div>
    </div>
    <div style="text-align:center;"><button type="submit" class="btn btn-danger" id="merge-submit-btn" disabled style="min-width:200px;">🔀 Merge Accounts</button></div>
  </form>
</div>

<script>
const users = { keep: { id: null, name: null, email: null }, merge: { id: null, name: null, email: null } };
let searchTimers = {};
function searchUser(q, side) {
  clearTimeout(searchTimers[side]);
  if (q.length < 2) { document.getElementById(side+'-results').innerHTML = ''; return; }
  searchTimers[side] = setTimeout(async () => {
    const r = await fetch('merge_users_search.php?q='+encodeURIComponent(q));
    if (!r.ok) return;
    const data = await r.json();
    const el = document.getElementById(side+'-results');
    el.innerHTML = data.map(u =>
      \`<div onclick="selectUser('\${side}',\${u.id},'\${u.username.replace(/'/g,"\\\\'")}','\${u.email.replace(/'/g,"\\\\'")}' )"
            style="padding:8px 10px;cursor:pointer;border-radius:6px;margin-bottom:2px;background:var(--bg-elevated,#1e1f23);border:1px solid var(--border-color,#2a2b2e);"
            onmouseover="this.style.background='var(--bg-hover,#252629)'" onmouseout="this.style.background='var(--bg-elevated,#1e1f23)'">
        <strong>\${u.username}</strong> <span style="color:var(--text-muted);font-size:0.8rem;">\${u.email}</span>
      </div>\`
    ).join('');
  }, 300);
}
function selectUser(side, id, name, email) {
  users[side] = { id, name, email };
  document.getElementById(side+'-id-input').value = id;
  document.getElementById(side+'-name').textContent = name;
  document.getElementById(side+'-email').textContent = email;
  document.getElementById(side+'-preview').style.display = 'block';
  document.getElementById(side+'-results').innerHTML = '';
  checkReady();
}
function checkReady() {
  const ok = users.keep.id && users.merge.id && users.keep.id !== users.merge.id;
  document.getElementById('merge-submit-btn').disabled = !ok;
}
function confirmMerge() {
  if (!users.keep.id || !users.merge.id) return false;
  return confirm(\`Are you SURE you want to merge "\${users.merge.name}" INTO "\${users.keep.name}"?\\n\\nThe "\${users.merge.name}" account will be permanently DELETED. This cannot be undone.\`);
}
</script>`;
  html += renderAdminFooter(siteUrl);
  await session.save(c, lifetime);
  return c.html(html);
});

adminMergeUsersRoutes.get('/admin/merge_users_search.php', async (c) => {
  const ctx = await buildAdminCtx(c);
  if (!ctx || !ctx.isOwner) return c.json([], 403);
  const { db, session, lifetime } = ctx;
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) { await session.save(c, lifetime); return c.json([]); }
  const users = await db.fetchAll('SELECT id, username, email FROM users WHERE username LIKE ? OR email LIKE ? LIMIT 8', [`%${q}%`, `%${q}%`]);
  await session.save(c, lifetime);
  return c.json(users);
});
