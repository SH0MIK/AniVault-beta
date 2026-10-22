import { Hono } from 'hono';
import type { Env } from '../index';
import { searchHoshikaAnime } from '../lib/hoshika-api';

export const mobileDiscoverRoutes = new Hono<{ Bindings: Env }>();

// Hoshika's public API currently provides title search, not the legacy MAL
// seasonal/top/broadcast feeds. Return an explicit empty state rather than
// silently filling these catalog views from MAL/Jikan/AniList.
function unavailable(c: any, view: string) {
  return c.json({
    success: true,
    source: 'hoshika',
    view,
    data: [],
    pagination: { current_page: 1, last_visible_page: 1 },
    message: 'This catalogue view is awaiting a Hoshika-native endpoint. Use title search in the meantime.',
  }, 200, { 'Cache-Control': 'no-store' });
}

mobileDiscoverRoutes.get('/api/mobile/seasonal', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return unavailable(c, 'seasonal');
  const data = await searchHoshikaAnime(q, 50, c.env.HOSHIKA_API_KEY);
  return c.json({
    success: true, source: 'hoshika', season: c.req.query('season') === 'upcoming' ? 'upcoming' : 'now',
    data: data.map((a) => ({
      id: a.shortId, shortId: a.shortId, title: a.title, image: a.poster,
      score: a.score, type: a.type, episodes: a.episodes ?? 0,
      status: a.status, year: a.year, genres: a.genres,
    })),
    pagination: { current_page: 1, last_visible_page: 1, has_next_page: false },
  }, 200, { 'Cache-Control': 'no-store' });
});

mobileDiscoverRoutes.get('/api/mobile/top', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return unavailable(c, 'top');
  const data = await searchHoshikaAnime(q, 50, c.env.HOSHIKA_API_KEY);
  return c.json({
    success: true, source: 'hoshika', filter: c.req.query('filter') ?? 'bypopularity',
    data: data.map((a) => ({
      id: a.shortId, shortId: a.shortId, title: a.title, image: a.poster,
      score: a.score, type: a.type, episodes: a.episodes ?? 0,
      status: a.status, year: a.year, genres: a.genres,
    })),
    pagination: { current_page: 1, last_visible_page: 1, has_next_page: false },
  }, 200, { 'Cache-Control': 'no-store' });
});

mobileDiscoverRoutes.get('/api/mobile/schedule', async (c) => unavailable(c, 'schedule'));

export default mobileDiscoverRoutes;
