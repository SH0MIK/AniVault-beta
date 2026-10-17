import { Hono } from 'hono';
import type { Env } from '../index';
import { Db } from '../lib/db';
import { Session } from '../lib/session';
import { Auth } from '../lib/auth';
import { MalAPI } from '../lib/mal-api';
import { buildCardMetaMap } from '../lib/anime-card';
import { getUserAnimeStatuses } from '../lib/user-list';
import { getAnimeEpisodeThumbnails } from '../lib/episode-thumb';

export const mobileHomeRoutes = new Hono<{ Bindings: Env }>();

async function buildCtx(c: any) {
  const db = new Db(c.env.DB);
  const lifetime = Number(c.env.SESSION_LIFETIME_SECONDS ?? 86400);
  const session = await Session.load(c, db, lifetime);
  const auth = new Auth(db, session, c.env as any, c.req.header('cf-connecting-ip') ?? 'unknown');
  const mal = new MalAPI(c.env as any, c.env.API_CACHE, db);
  return { db, session, auth, mal };
}

function toCard(a: any, meta: any, userStatus: string | null) {
  return {
    id: a.mal_id,
    title: a.title_english && a.title_english !== a.title ? a.title_english : a.title,
    image: a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? '',
    score: a.score ?? null,
    type: a.type ?? '',
    episodes: a.episodes ?? 0,
    airedInfo: meta?.airedInfo ?? null,
    dubbedLangs: meta?.dubbedLangs ?? [],
    userStatus,
  };
}

mobileHomeRoutes.get('/api/mobile/home-v2', async (c) => {
  const { db, auth, mal } = await buildCtx(c);
  const [seasonal, topAnime, upcoming] = await Promise.all([
    mal.getAniListSeasonNow(),
    mal.getTopAnime('bypopularity', 1),
    mal.getSeasonUpcoming(),
  ]);

  let watchNowList: any[] = [];
  try {
    const rows = await db.fetchAll<{ anime_id: number }>('SELECT DISTINCT anime_id FROM episode_videos WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 12');
    const results = await Promise.all(rows.map((r) => mal.getAnime(r.anime_id, true)));
    watchNowList = results.map((r) => r.data).filter(Boolean);
  } catch {
    watchNowList = [];
  }

  const currentUser = auth.check() ? await auth.getCurrentUser() : null;
  const userStatuses = currentUser ? await getUserAnimeStatuses(db, currentUser.id) : {};
  const allItems = [
    ...(seasonal.data ?? []).slice(0, 12),
    ...(topAnime.data ?? []).slice(0, 12),
    ...(upcoming.data ?? []).slice(0, 8),
    ...watchNowList,
  ];
  const cardMeta = await buildCardMetaMap(db, allItems);

  let continueWatching: any[] = [];
  if (currentUser) {
    try {
      const rows = await db.fetchAll<any>(
        'SELECT anime_id, anime_title, anime_image, episode_num, ep_title, ep_thumb, watched_at, watch_time, episode_duration FROM watch_history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 8',
        [currentUser.id]
      );
      const ids = [...new Set(rows.map((r) => Number(r.anime_id)))];
      const details = new Map<number, any>();
      await Promise.all(ids.map(async (id) => {
        await mal.getAnimeEpisodes(id).catch(() => null);
        const result = await mal.getAnime(id, true).catch(() => null);
        details.set(id, result?.data ?? null);
      }));
      const thumbs = new Map<number, Record<number, string>>();
      await Promise.all(ids.map(async (id) => {
        thumbs.set(id, await getAnimeEpisodeThumbnails(c.env, db, id));
      }));
      continueWatching = rows.map((r) => ({
        animeId: r.anime_id,
        title: r.anime_title,
        image: details.get(Number(r.anime_id))?.images?.jpg?.large_image_url || '',
        episodeNum: r.episode_num,
        epTitle: r.ep_title,
        epThumb: thumbs.get(Number(r.anime_id))?.[Number(r.episode_num)] || '',
        watchTime: r.watch_time,
        episodeDuration: r.episode_duration,
      }));
    } catch {
      continueWatching = [];
    }
  }

  const hero: any[] = [];
  try {
    const curatedRows = await db.fetchAll<any>('SELECT anime_id FROM home_hero_banners ORDER BY display_order ASC LIMIT 8');
    if (curatedRows.length) {
      const curated = await Promise.all(curatedRows.map((r) => mal.getAnime(r.anime_id, false)));
      for (const result of curated) {
        const a = result?.data;
        if (!a) continue;
        hero.push({
          id: a.mal_id,
          title: a.title_english && a.title_english !== a.title ? a.title_english : a.title,
          image: a.images?.jpg?.large_image_url || '',
          banner: a.cover_image || '',
          logo: '',
          synopsis: a.synopsis || '',
          score: a.score ?? null,
          type: a.type ?? '',
          episodes: a.episodes ?? 0,
          genres: (a.genres ?? []).slice(0, 3).map((g: any) => g.name),
        });
      }
    }
  } catch {
    // Fall through to AniList season banners.
  }

  if (!hero.length) {
    for (const a of (seasonal.data ?? []).slice(0, 6)) {
      hero.push({
        id: a.mal_id,
        title: a.title_english && a.title_english !== a.title ? a.title_english : a.title,
        image: a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? '',
        banner: a.banner_image ?? '',
        logo: a.logo_image ?? '',
        synopsis: a.synopsis ?? '',
        score: a.score ?? null,
        type: a.type ?? '',
        episodes: a.episodes ?? 0,
        genres: (a.genres ?? []).slice(0, 3).map((g: any) => g.name),
      });
    }
  }

  const genreList = mal.getAnimeGenres().data;
  return c.json({
    success: true,
    hero,
    genres: genreList,
    seasonal: (seasonal.data ?? []).slice(0, 12).map((a: any) => toCard(a, cardMeta.get(a.mal_id), userStatuses[a.mal_id] ?? null)),
    top: (topAnime.data ?? []).slice(0, 12).map((a: any) => toCard(a, cardMeta.get(a.mal_id), userStatuses[a.mal_id] ?? null)),
    upcoming: (upcoming.data ?? []).slice(0, 8).map((a: any) => toCard(a, cardMeta.get(a.mal_id), userStatuses[a.mal_id] ?? null)),
    watchNow: watchNowList.map((a: any) => toCard(a, cardMeta.get(a.mal_id), userStatuses[a.mal_id] ?? null)),
    continueWatching,
  });
});
