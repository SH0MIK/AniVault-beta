import type { Env } from './index';
import { Db } from './lib/db';
import { MalAPI } from './lib/mal-api';

// Runs on a Cloudflare Cron Trigger (see [triggers] in wrangler.toml).
// Refreshes the AniList "this season" cache proactively so normal page
// requests almost always read a warm KV entry instead of calling AniList
// live — this is the same idea as Anivexa's own backend proxy/cache, just
// running as a Worker cron instead of a separate always-on server.
export async function handleScheduled(env: Env): Promise<void> {
  const db = new Db(env.DB);
  const mal = new MalAPI(env, env.API_CACHE, db);

  const ok = await mal.refreshAniListSeasonCache();
  console.log(ok
    ? '[scheduled] AniList season cache refreshed'
    : '[scheduled] AniList season refresh failed — existing cache (or MAL fallback) stays in place until next run');
}
