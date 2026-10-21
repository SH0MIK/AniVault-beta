// Ports api/episode_override.php.
import { Hono } from 'hono';
import type { Env } from '../index';
import { Db } from '../lib/db';
import { Session } from '../lib/session';
import { Auth } from '../lib/auth';
import { findIdentityByLegacyMalId } from '../lib/anime-identity';
import { getHoshikaAnimeById, getHoshikaAnimeEpisodesById } from '../lib/hoshika-api';
import { Logger } from '../lib/logger';
import { getAnimeEpisodeThumbnails, getEpisodeThumbnail } from '../lib/episode-thumb';

export const episodeOverrideRoutes = new Hono<{ Bindings: Env }>();

const ALLOWED_SERVICES = ['crunchyroll', 'netflix', 'hidive', 'funimation', 'amazon', 'hulu', 'apple', 'disney', 'youtube', 'bilibili'];

function isValidUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

episodeOverrideRoutes.on(['GET', 'POST'], '/api/episode_override.php', async (c) => {
  const db = new Db(c.env.DB);
  const lifetime = Number(c.env.SESSION_LIFETIME_SECONDS ?? 86400);
  const session = await Session.load(c, db, lifetime);
  const auth = new Auth(db, session, c.env as any, c.req.header('cf-connecting-ip') ?? 'unknown');

  const animeId = parseInt(c.req.query('anime_id') ?? '0', 10) || 0;
  const epNum = parseInt(c.req.query('ep') ?? '0', 10) || 0;

  if (c.req.method === 'GET') {
    if (animeId && c.req.query('all') !== undefined) {
      const rows: any[] = await db.fetchAll('SELECT * FROM episode_overrides WHERE anime_id = ?', [animeId]);
      // Legacy override rows use MAL IDs. Bridge to Hoshika only when that
      // exact relationship has been explicitly verified in anime_identity_map.
      const identity = await findIdentityByLegacyMalId(db, animeId).catch(() => null);
      const hoshikaId = identity?.verified === 1 ? identity.hoshika_short_id : null;
      const [animeData, hoshikaEpisodes] = hoshikaId
        ? await Promise.all([
            getHoshikaAnimeById(hoshikaId),
            getHoshikaAnimeEpisodesById(hoshikaId),
          ])
        : [null, null];
      const totalEps = hoshikaEpisodes?.length || animeData?.episodes || 0;

      // Preserve admin overrides; prefer Hoshika stills for verified mappings,
      // then fill any remaining gaps from the existing scraper thumbnail cache.
      const overriddenEps = new Set(rows.map((r) => Number(r.episode_num)));
      const combined = [...rows];
      for (const ep of hoshikaEpisodes ?? []) {
        if (!overriddenEps.has(ep.number) && ep.thumbnail) {
          combined.push({ anime_id: animeId, episode_num: ep.number, image_url: ep.thumbnail });
          overriddenEps.add(ep.number);
        }
      }
      const scraped = await getAnimeEpisodeThumbnails(c.env, db, animeId, undefined, totalEps);
      for (const [epNumStr, image_url] of Object.entries(scraped)) {
        const epNum = Number(epNumStr);
        if (!overriddenEps.has(epNum)) combined.push({ anime_id: animeId, episode_num: epNum, image_url });
      }

      await session.save(c, lifetime);
      return c.json({ success: true, overrides: combined, total_eps: totalEps });
    }

    if (!animeId || !epNum) {
      await session.save(c, lifetime);
      return c.json({ success: false, error: 'Missing params' });
    }
    const row = await db.fetchOne<any>('SELECT * FROM episode_overrides WHERE anime_id = ? AND episode_num = ?', [animeId, epNum]);
    let watchLinks: any[] = [];
    if (row?.watch_links) { try { watchLinks = JSON.parse(row.watch_links); } catch { /* ignore */ } }

    // Same fallback as the ?all=1 branch above, just for one episode: an
    // admin override wins, otherwise fall back to our own scraper's D1
    // cache (getEpisodeThumbnail already checks the per-episode row, then
    // the per-anime bulk row, before ever hitting the scraper live). This
    // used to be missing entirely here, which is why the episode modal on
    // the anime detail page had its own separate direct-to-AniList call --
    // that's no longer needed now that this endpoint resolves it too.
    let thumbnail: string | null = row?.image_url ?? null;
    if (!thumbnail) {
      // Never interpret a MAL ID as a Hoshika ID; require a verified mapping.
      const identity = await findIdentityByLegacyMalId(db, animeId).catch(() => null);
      if (identity?.verified === 1) {
        const episodes = await getHoshikaAnimeEpisodesById(identity.hoshika_short_id);
        thumbnail = episodes?.find((ep) => ep.number === epNum)?.thumbnail || null;
      }
      if (!thumbnail) thumbnail = await getEpisodeThumbnail(c.env, db, animeId, epNum);
    }

    await session.save(c, lifetime);
    return c.json({ success: true, override: row ?? null, watch_links: watchLinks, thumbnail });
  }

  // ── DELETE via POST ?action=delete ──────────────────────
  if (c.req.method === 'POST' && c.req.query('action') === 'delete') {
    if (!auth.isAdmin()) {
      await session.save(c, lifetime);
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const id = parseInt(c.req.query('id') ?? '0', 10) || 0;
    if (id) {
      await db.query('DELETE FROM episode_overrides WHERE id = ?', [id]);
    } else {
      if (!animeId || !epNum) { await session.save(c, lifetime); return c.json({ success: false, error: 'Missing id' }); }
      await db.query('DELETE FROM episode_overrides WHERE anime_id = ? AND episode_num = ?', [animeId, epNum]);
    }
    await session.save(c, lifetime);
    return c.json({ success: true });
  }

  // ── POST (save override) ────────────────────────────────
  if (c.req.method === 'POST') {
    if (!auth.isAdmin()) {
      await session.save(c, lifetime);
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const body: any = await c.req.json().catch(() => ({}));
    const bAnimeId = parseInt(body.anime_id ?? '0', 10) || 0;
    const bEpNum = parseInt(body.episode_num ?? '0', 10) || 0;
    const imageUrl = (body.image_url ?? '').trim();
    const synopsis = (body.synopsis ?? '').trim();
    const links = Array.isArray(body.watch_links) ? body.watch_links : [];

    if (!bAnimeId || !bEpNum) {
      await session.save(c, lifetime);
      return c.json({ success: false, error: 'Missing anime_id or episode_num' });
    }

    const cleanLinks = links
      .map((l: any) => ({ service: (l.service ?? '').toLowerCase().trim(), url: (l.url ?? '').trim() }))
      .filter((l: any) => ALLOWED_SERVICES.includes(l.service) && isValidUrl(l.url));

    await db.query(
      `INSERT INTO episode_overrides (anime_id, episode_num, image_url, synopsis, watch_links, updated_by)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(anime_id, episode_num) DO UPDATE SET
         image_url=excluded.image_url, synopsis=excluded.synopsis, watch_links=excluded.watch_links,
         updated_by=excluded.updated_by, updated_at=datetime('now')`,
      [bAnimeId, bEpNum, imageUrl || null, synopsis || null, JSON.stringify(cleanLinks), session.user_id]
    );
    await Logger.log(db, session.user_id!, 'episode_override', `Edited ep ${bEpNum} of anime ${bAnimeId}`);
    await session.save(c, lifetime);
    return c.json({ success: true });
  }

  await session.save(c, lifetime);
  return c.json({ success: false, error: 'Method not allowed' }, 405);
});
