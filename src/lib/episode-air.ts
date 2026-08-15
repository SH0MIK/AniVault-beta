// Primary source: your own scraper API's /api/info?malId=X, which returns
// episodeCount for whatever it has actually indexed across your streaming
// providers (animeheaven/anikoto/zoro/etc). One fast call, and it reflects
// what's really watchable on-site rather than a third-party field.
//
// Fallback: MAL's `num_episodes` field is frequently 0/stale/wrong for
// currently-airing shows, and the scraper may not have ingested a title yet
// — in that case this falls back to counting actual aired episodes from
// Jikan's per-episode air-date data, which updates promptly as each episode
// airs (but is expensive: pagination, rate-limited 3req/s).
//
// Either way this isn't cheap enough to compute live for a card grid, so
// it's cached in `episode_air_cache`. Only the single-anime detail page does
// a synchronous refresh-if-stale; grids only ever read the cache (see
// getForMany).
import { Db } from './db';
import { MalAPI } from './mal-api';

const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_PAGES = 15; // 15 * 100 = up to 1500 episodes tracked; covers everything but a handful of very long runners

export interface AiredInfo { aired: number; total: number | null; updatedAt: string; }
export interface EpisodeAirEnv { SCRAPER_API_BASE?: string; }

export const EpisodeAir = {
  /** Scraper API lookup — same base-URL handling as api-scraper.ts (accepts
   *  either "https://host" or "https://host/api"). Returns null on any
   *  failure or missing/zero episodeCount so callers fall through to Jikan. */
  async fetchFromScraperApi(env: EpisodeAirEnv, animeId: number): Promise<{ aired: number; total: number } | null> {
    const base = env.SCRAPER_API_BASE?.replace(/\/+$/, '').replace(/\/api$/i, '');
    if (!base) return null;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${base}/api/info?malId=${animeId}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const data: any = await res.json().catch(() => null);
      const count = Number(data?.episodeCount);
      if (!count || count <= 0) return null;
      // The scraper only exposes one count, not an aired/total split — treat
      // it as both. For a streaming site this is arguably more useful than
      // MAL's "aired" distinction anyway: it's the number of episodes your
      // site actually has, which is what drives the episode grid.
      return { aired: count, total: count };
    } catch {
      return null;
    }
  },

  /** Does the actual Jikan fetch + count. No caching here — callers decide when this is worth running. */
  async fetchAiredCountFromJikan(mal: MalAPI, animeId: number): Promise<{ aired: number; total: number } | null> {
    let aired = 0;
    let total = 0;
    let page = 1;
    const now = Date.now();

    while (page <= MAX_PAGES) {
      const res = await mal.getAnimeEpisodes(animeId, page);
      const eps: any[] = res?.data ?? [];
      if (!eps.length) break;
      for (const ep of eps) {
        total++;
        if (ep.aired && new Date(ep.aired).getTime() <= now) aired++;
      }
      if (!res?.pagination?.has_next_page) break;
      page++;
    }
    if (total === 0) return null; // Jikan has nothing for this title — leave MAL's own count as the fallback
    return { aired, total };
  },

  /** Scraper API first, Jikan pagination fallback. */
  async fetchAiredCount(env: EpisodeAirEnv, mal: MalAPI, animeId: number): Promise<{ aired: number; total: number } | null> {
    const fromScraper = await EpisodeAir.fetchFromScraperApi(env, animeId);
    if (fromScraper) return fromScraper;
    return EpisodeAir.fetchAiredCountFromJikan(mal, animeId);
  },

  /** Read-through cache for a single anime — used by the detail page, where the extra round trip on a cache miss is worth it. */
  async get(db: Db, env: EpisodeAirEnv, mal: MalAPI, animeId: number): Promise<AiredInfo | null> {
    const cached = await db.fetchOne<{ aired_count: number; total_count: number | null; updated_at: string }>(
      'SELECT aired_count, total_count, updated_at FROM episode_air_cache WHERE anime_id = ?', [animeId]
    );
    const isFresh = cached && (Date.now() - new Date(cached.updated_at.replace(' ', 'T') + 'Z').getTime()) < STALE_AFTER_MS;
    if (cached && isFresh) return { aired: cached.aired_count, total: cached.total_count, updatedAt: cached.updated_at };

    const fetched = await EpisodeAir.fetchAiredCount(env, mal, animeId);
    if (!fetched) return cached ? { aired: cached.aired_count, total: cached.total_count, updatedAt: cached.updated_at } : null;

    await db.query(
      `INSERT INTO episode_air_cache (anime_id, aired_count, total_count, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(anime_id) DO UPDATE SET aired_count=excluded.aired_count, total_count=excluded.total_count, updated_at=excluded.updated_at`,
      [animeId, fetched.aired, fetched.total]
    );
    return { aired: fetched.aired, total: fetched.total, updatedAt: new Date().toISOString() };
  },

  /** Cache-only bulk lookup for card grids — never calls the scraper API or Jikan directly, so it's always fast regardless of how many cards are on the page. */
  async getForMany(db: Db, animeIds: number[]): Promise<Map<number, AiredInfo>> {
    const map = new Map<number, AiredInfo>();
    if (!animeIds.length) return map;
    const placeholders = animeIds.map(() => '?').join(',');
    const rows = await db.fetchAll<{ anime_id: number; aired_count: number; total_count: number | null; updated_at: string }>(
      `SELECT anime_id, aired_count, total_count, updated_at FROM episode_air_cache WHERE anime_id IN (${placeholders})`,
      animeIds
    );
    for (const row of rows) map.set(row.anime_id, { aired: row.aired_count, total: row.total_count, updatedAt: row.updated_at });
    return map;
  },

  /** Cron entry point — refreshes the stalest cached entries so card grids stay reasonably current without any page view ever blocking on the scraper API or Jikan. */
  async refreshStale(db: Db, env: EpisodeAirEnv, mal: MalAPI, limit = 20): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString().replace('T', ' ').substring(0, 19);
    const stale = await db.fetchAll<{ anime_id: number }>(
      'SELECT anime_id FROM episode_air_cache WHERE updated_at < ? ORDER BY updated_at ASC LIMIT ?', [cutoff, limit]
    );
    let refreshed = 0;
    for (const row of stale) {
      const fetched = await EpisodeAir.fetchAiredCount(env, mal, row.anime_id);
      if (fetched) {
        await db.query('UPDATE episode_air_cache SET aired_count=?, total_count=?, updated_at=datetime(\'now\') WHERE anime_id=?', [fetched.aired, fetched.total, row.anime_id]);
        refreshed++;
      }
    }
    return refreshed;
  },
};
