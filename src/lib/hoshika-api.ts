/**
 * Public Hoshika catalog adapter.
 *
 * The documented catalog endpoints are searched without credentials. We
 * intentionally do not call user-library endpoints or require an OAuth token.
 * Episode metadata and episode stills are loaded from Hoshika's public
 * /api/v1/anime/{shortId}/episodes endpoint when available.
 */
export interface HoshikaAnimeMetadata {
  poster: string;
  cover: string;
  episodes: number | null;
}

function obj(value: any): any {
  return value && typeof value === 'object' ? value : {};
}

function unwrap(payload: any): any {
  let value = payload;
  for (let i = 0; i < 4; i++) {
    const x = obj(value);
    if (x.data !== undefined) value = x.data;
    else if (x.anime !== undefined) value = x.anime;
    else if (x.item !== undefined) value = x.item;
    else break;
  }
  return value;
}

function resultsFrom(payload: any): any[] {
  const root = obj(payload);
  const data = unwrap(root);
  const candidates = [
    root.results, root.items, root.anime,
    data?.results, data?.items, data?.anime,
    data?.data?.results, data?.data?.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

function imageUrl(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    if (value && typeof value === 'object') {
      const nested = imageUrl(value.url, value.src, value.medium, value.large, value.original, value.webp);
      if (nested) return nested;
    }
  }
  return '';
}

function posterFrom(item: any): string {
  const x = obj(item);
  const images = obj(x.images);
  const poster = obj(x.poster);
  const cover = obj(x.cover);
  const mainPicture = obj(x.main_picture);
  return imageUrl(
    // Prefer a CDN-provided medium/small variant for card posters instead of
    // downloading the original artwork when Hoshika exposes multiple sizes.
    poster.medium, poster.small, images.poster_medium, images.poster_small,
    images.medium, images.small, mainPicture.medium, mainPicture.small,
    x.poster_url, x.posterUrl, x.cover_url, x.coverUrl, x.cover_image, x.coverImage,
    poster, cover, images.poster, images.cover, images.cover_image, images.poster_url,
    images.original, images.large, images.medium, mainPicture.large,
    x.image, x.image_url, x.thumbnail,
  );
}

function coverFrom(item: any): string {
  const x = obj(item);
  const images = obj(x.images);
  const banner = obj(x.banner);
  return imageUrl(
    x.banner_url, x.bannerUrl, x.bannerImage, x.backdrop_url, x.backdropUrl,
    banner, images.banner, images.backdrop, images.banner_url, images.backdrop_url,
  );
}

function episodeCountFrom(item: any): number | null {
  const x = obj(item);
  const raw = x.episodes ?? x.num_episodes ?? x.episode_count ?? x.episodeCount ?? x.total_episodes;
  if (Array.isArray(raw)) return raw.length;
  const value = raw && typeof raw === 'object'
    ? (raw.total ?? raw.count ?? raw.sub ?? raw.eps)
    : raw;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function shortIdFrom(item: any): string {
  const x = obj(item);
  const id = x.shortId ?? x.short_id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function normaliseTitle(value: any): string {
  return typeof value === 'string'
    ? value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
    : '';
}

/**
 * Hoshika search records may not expose a MAL ID. Match title variants
 * instead of treating Hoshika's internal shortId as a MAL ID.
 */
function titleMatchScore(item: any, title: string): number {
  const x = obj(item);
  const wanted = normaliseTitle(title);
  if (!wanted) return 0;
  const variants = [
    x.titleEnglish, x.titleRomaji, x.titleLocalized, x.titleJapanese,
    x.title, x.slug,
  ].map(normaliseTitle).filter(Boolean);
  if (variants.some((candidate) => candidate === wanted)) return 100;
  if (variants.some((candidate) => candidate.startsWith(wanted) || wanted.startsWith(candidate))) return 80;
  return 0;
}


export interface HoshikaEpisode {
  number: number;
  title: string;
  aired: string | null;
  thumbnail: string;
  filler: boolean;
  recap: boolean;
}

function episodeThumbnailFrom(item: any): string {
  const seen = new Set<any>();
  const candidates = [
    item?.thumbnail, item?.thumbnailUrl, item?.thumbnail_url,
    item?.image, item?.imageUrl, item?.image_url,
    item?.still, item?.stillUrl, item?.still_url,
    item?.preview, item?.previewUrl, item?.preview_url,
    item?.poster, item?.images, item?.artwork,
  ];
  const visit = (value: any, depth = 0): string => {
    if (depth > 5 || value == null) return '';
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw || raw.startsWith('data:') || raw.startsWith('javascript:')) return '';
      try {
        const url = new URL(raw, 'https://hoshika.app');
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
      } catch { return ''; }
    }
    if (typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = visit(entry, depth + 1);
        if (found) return found;
      }
      return '';
    }
    for (const key of ['url', 'src', 'href', 'original', 'originalUrl', 'full', 'large', 'medium', 'small', 'webp', 'thumbnail', 'thumbnailUrl', 'image', 'imageUrl', 'still', 'preview', 'path']) {
      const found = visit(value[key], depth + 1);
      if (found) return found;
    }
    return '';
  };
  for (const candidate of candidates) {
    const found = visit(candidate);
    if (found) return found;
  }
  return '';
}


/**
 * Resolve episode numbers and stills from Hoshika's public catalog.
 * Search results identify Hoshika anime by shortId; this is NOT a MAL ID.
 * The endpoint's documented response shape is { items, total, nextAfter }.
 */
export async function getHoshikaAnimeEpisodes(
  title: string,
  kv?: KVNamespace,
): Promise<HoshikaEpisode[] | null> {
  if (!title) return null;

  const searchUrl = new URL('https://hoshika.app/api/v1/search');
  searchUrl.searchParams.set('q', title);
  try {
    const searchResponse = await fetch(searchUrl.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!searchResponse.ok) return null;
    const searchPayload: any = await searchResponse.json();
    if (searchPayload?.ok === false) return null;

    const match = resultsFrom(searchPayload)
      .map((item) => ({ item, score: titleMatchScore(item, title) }))
      .filter((entry) => entry.score >= 80)
      .sort((a, b) => b.score - a.score)[0]?.item;
    const shortId = shortIdFrom(match);
    if (!match || !shortId) return null;


    const episodes: HoshikaEpisode[] = [];
    let after: string | null = null;
    // Bound pagination so malformed cursors cannot cause an unbounded Worker request.
    for (let page = 0; page < 10; page++) {
      const url = new URL(`https://hoshika.app/api/v1/anime/${encodeURIComponent(shortId)}/episodes`);
      url.searchParams.set('locale', 'en');
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return episodes.length ? episodes : null;
      const payload: any = await response.json();
      if (payload?.ok === false || !Array.isArray(payload?.items)) {
        return episodes.length ? episodes : null;
      }

      for (const item of payload.items) {
        const number = Number(item?.number);
        const thumbnail = episodeThumbnailFrom(item);
        if (!Number.isInteger(number) || number < 1) continue;
        episodes.push({
          number,
          title: typeof item?.title === 'string' ? item.title : `Episode ${number}`,
          aired: typeof item?.aired === 'string' ? item.aired : null,
          thumbnail,
          filler: !!item?.filler,
          recap: !!item?.recap,
        });
      }

      after = typeof payload.nextAfter === 'string' && payload.nextAfter ? payload.nextAfter : null;
      if (!after || payload.items.length === 0) break;
    }

    episodes.sort((a, b) => a.number - b.number);
    return episodes.length ? episodes : null;
  } catch (error) {
    console.warn('[hoshika] Public episode lookup failed:', String(error));
    return null;
  }
}

/**
 * Fetch episodes directly by Hoshika shortId. This is the preferred API for
 * migrated pages; it avoids title matching and never interprets IDs as MAL.
 */
export async function getHoshikaAnimeEpisodesById(shortIdValue: string | number): Promise<HoshikaEpisode[] | null> {
  const shortId = String(shortIdValue ?? '').trim();
  if (!shortId) return null;
  const episodes: HoshikaEpisode[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < 10; page++) {
      const url = new URL(`https://hoshika.app/api/v1/anime/${encodeURIComponent(shortId)}/episodes`);
      url.searchParams.set('locale', 'en');
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!response.ok) return episodes.length ? episodes : null;
      const payload: any = await response.json();
      if (payload?.ok === false || !Array.isArray(payload?.items)) return episodes.length ? episodes : null;
      for (const item of payload.items) {
        const number = Number(item?.number);
        if (!Number.isInteger(number) || number < 1) continue;
        episodes.push({
          number,
          title: typeof item?.title === 'string' && item.title.trim() ? item.title : `Episode ${number}`,
          aired: typeof item?.aired === 'string' ? item.aired : null,
          thumbnail: episodeThumbnailFrom(item),
          filler: !!item?.filler,
          recap: !!item?.recap,
        });
      }
      after = typeof payload.nextAfter === 'string' && payload.nextAfter ? payload.nextAfter : null;
      if (!after || payload.items.length === 0) break;
    }
    episodes.sort((a, b) => a.number - b.number);
    return episodes.length ? episodes : null;
  } catch (error) {
    console.warn('[hoshika] Episode lookup by ID failed:', String(error));
    return episodes.length ? episodes : null;
  }
}

function metadataFrom(item: any): HoshikaAnimeMetadata {
  return {
    poster: posterFrom(item),
    cover: coverFrom(item),
    episodes: episodeCountFrom(item),
  };
}

/**
 * Resolve a MAL ID against Hoshika's public catalog. Search is one request in
 * the common case; detail is only fetched for a single-title/detail request
 * when search results do not include the requested fields. Legacy KV caches
 * are deliberately bypassed during migration so only live Hoshika responses are used.
 */
export async function getHoshikaAnimeMetadata(
  malId: number,
  title: string,
  kv?: KVNamespace,
  includeDetail = false,
): Promise<HoshikaAnimeMetadata | null> {
  if (!malId || !title) return null;


  try {
    const url = new URL('https://hoshika.app/api/v1/search');
    url.searchParams.set('q', title);
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload: any = await response.json();
    if (payload?.ok === false) return null;

    const match = resultsFrom(payload)
      .map((item) => ({ item, score: titleMatchScore(item, title) }))
      .filter((entry) => entry.score >= 80)
      .sort((a, b) => b.score - a.score)[0]?.item;
    if (!match) {
      return null;
    }

    let result = metadataFrom(match);
    const shortId = shortIdFrom(match);
    const needsDetail = includeDetail && shortId && (!result.poster || result.episodes === null || !result.cover);
    if (needsDetail) {
      const detailResponse = await fetch(
        `https://hoshika.app/api/v1/anime/${encodeURIComponent(shortId)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (detailResponse.ok) {
        const detailPayload: any = await detailResponse.json();
        if (detailPayload?.ok !== false) {
          const detail = unwrap(detailPayload);
          const detailMetadata = metadataFrom(detail);
          result = {
            poster: detailMetadata.poster || result.poster,
            cover: detailMetadata.cover || result.cover,
            episodes: detailMetadata.episodes ?? result.episodes,
          };
        }
      }
    }

    return result.poster || result.cover || result.episodes !== null ? result : null;
  } catch (error) {
    console.warn('[hoshika] Public catalog lookup failed:', String(error));
    return null;
  }
}


/**
 * Hoshika-native catalog record. Hoshika shortId is the canonical AniVault
 * catalog ID during the migration; it must never be interpreted as a MAL ID.
 */
export interface HoshikaCatalogAnime {
  id: string;
  shortId: string;
  slug: string;
  title: string;
  titleEnglish: string;
  titleRomaji: string;
  titleJapanese: string;
  synopsis: string;
  poster: string;
  cover: string;
  episodes: number | null;
  score: number | null;
  status: string;
  type: string;
  year: number | null;
  genres: string[];
  raw: any;
}

function firstText(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseHoshikaAnime(item: any): HoshikaCatalogAnime | null {
  const x = obj(item);
  const shortId = shortIdFrom(x);
  if (!shortId) return null;
  const titleEnglish = firstText(x.titleEnglish, x.title_english, x.titles?.english);
  const titleRomaji = firstText(x.titleRomaji, x.title_romaji, x.titles?.romaji);
  const titleJapanese = firstText(x.titleJapanese, x.title_japanese, x.titles?.japanese);
  const title = firstText(x.title, titleEnglish, titleRomaji, titleJapanese, x.slug);
  const rawGenres = Array.isArray(x.genres) ? x.genres : [];
  const genres = rawGenres.map((g: any) => typeof g === 'string' ? g : firstText(g?.name, g?.title)).filter(Boolean);
  const rawYear = x.year ?? x.seasonYear ?? x.startYear ?? x.start_date?.year;
  return {
    id: String(x.id ?? shortId),
    shortId,
    slug: typeof x.slug === 'string' ? x.slug : '',
    title,
    titleEnglish,
    titleRomaji,
    titleJapanese,
    synopsis: firstText(x.synopsis, x.description, x.overview),
    poster: posterFrom(x),
    cover: coverFrom(x),
    episodes: episodeCountFrom(x),
    score: numberOrNull(x.score ?? x.rating ?? x.mean),
    status: firstText(x.status, x.airingStatus),
    type: firstText(x.type, x.format, x.mediaType),
    year: numberOrNull(rawYear),
    genres,
    raw: x,
  };
}

/** Search only Hoshika. No MAL/Jikan/AniList fallback and no KV cache. */
export async function searchHoshikaAnime(query: string, limit = 20): Promise<HoshikaCatalogAnime[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const url = new URL('https://hoshika.app/api/v1/search');
    url.searchParams.set('q', q);
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const payload: any = await response.json();
    if (payload?.ok === false) return [];
    return resultsFrom(payload)
      .map(normaliseHoshikaAnime)
      .filter((anime): anime is HoshikaCatalogAnime => !!anime)
      .slice(0, Math.max(1, Math.min(50, Math.trunc(limit))));
  } catch (error) {
    console.warn('[hoshika] Search failed:', String(error));
    return [];
  }
}

/** Fetch one catalog record using Hoshika's canonical shortId. */
export async function getHoshikaAnimeById(shortId: string | number): Promise<HoshikaCatalogAnime | null> {
  const id = String(shortId ?? '').trim();
  if (!id) return null;
  try {
    const response = await fetch(
      `https://hoshika.app/api/v1/anime/${encodeURIComponent(id)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const payload: any = await response.json();
    if (payload?.ok === false) return null;
    const record = normaliseHoshikaAnime(unwrap(payload));
    return record?.shortId ? record : null;
  } catch (error) {
    console.warn('[hoshika] Detail lookup failed:', String(error));
    return null;
  }
}
