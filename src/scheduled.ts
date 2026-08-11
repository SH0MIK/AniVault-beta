import type { Env } from './index';
import { Db } from './lib/db';
import { MalAPI } from './lib/mal-api';
import { EpisodeAir } from './lib/episode-air';
import { DubStatus } from './lib/dub-status';

// Runs on Cloudflare Cron Triggers (see [triggers] in wrangler.toml). Two
// separate schedules feed into this one handler, distinguished by
// event.cron:
//   "0 * * * *"  (hourly) -> refresh the stalest episode-air-count cache
//                            entries, so card grids stay reasonably fresh
//                            without any page view ever blocking on Jikan.
//   "0 3 * * *"  (daily)  -> refresh dub_status from MyDubList.
//
// Note: this does NOT handle the AniList season cache — that's relayed
// through GitHub Actions instead (.github/workflows/anilist-cache.yml)
// because graphql.anilist.co blocks Cloudflare Workers' IP ranges. Both
// Jikan and raw.githubusercontent.com (used here) are unaffected by that.
export async function handleScheduled(env: Env, cron?: string): Promise<void> {
  const db = new Db(env.DB);
  const mal = new MalAPI(env, env.API_CACHE, db);

  if (cron === '0 3 * * *') {
    const results = await DubStatus.refresh(db);
    console.log('[scheduled] dub_status refresh: ' + results.map((r) => `${r.lang}=${r.ok ? r.count : 'FAILED'}`).join(', '));
    return;
  }

  // Default to the hourly episode-air task (covers manual "Run workflow"
  // triggers too, which don't set event.cron to either exact string).
  const refreshed = await EpisodeAir.refreshStale(db, mal, 20);
  console.log(`[scheduled] episode_air_cache: refreshed ${refreshed} stale entr${refreshed === 1 ? 'y' : 'ies'}`);
}
