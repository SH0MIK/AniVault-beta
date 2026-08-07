// Fetches the current season's anime from AniList and writes it into the
// same Cloudflare KV namespace / key that the Worker reads from
// (src/lib/mal-api.ts -> getAniListSeasonNow / seasonCacheKey).
//
// This runs OUTSIDE Cloudflare on purpose — AniList has manually blocked
// Cloudflare Workers' IP ranges (confirmed via the 403 "manually blocked"
// response), so the fetch can never succeed from inside a Worker. Running
// it here (GitHub Actions) and pushing the result into KV over Cloudflare's
// REST API sidesteps that entirely; the Worker never talks to AniList.
//
// Required env vars (set as GitHub repo secrets):
//   CF_API_TOKEN        - Cloudflare API token with "Workers KV Storage: Edit"
//   CF_ACCOUNT_ID        - Cloudflare account ID
//   CF_KV_NAMESPACE_ID   - the API_CACHE namespace ID (see wrangler.toml)

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;

if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID) {
  console.error('Missing one of CF_API_TOKEN / CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID env vars.');
  process.exit(1);
}

function stripAniListHtml(input) {
  return (input || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function currentSeason() {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const seasonYear = now.getUTCFullYear();
  const season = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL';
  return { season, seasonYear };
}

async function fetchAniListSeason(season, seasonYear) {
  const query = `
    query ($season: MediaSeason, $seasonYear: Int) {
      Page(page: 1, perPage: 50) {
        media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
          idMal
          title { romaji english }
          description(asHtml: false)
          bannerImage
          coverImage { large extraLarge }
          genres
          episodes
          averageScore
          format
          status
        }
      }
    }`;

  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { season, seasonYear } }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`AniList HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text);
  if (json.errors?.length) {
    throw new Error(`AniList GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }

  const media = json?.data?.Page?.media ?? [];
  return media
    .filter((m) => m.idMal)
    .map((m) => ({
      mal_id: m.idMal,
      title: m.title?.romaji || m.title?.english || 'Unknown',
      title_english: m.title?.english || '',
      title_japanese: '',
      images: {
        jpg: {
          image_url: m.coverImage?.large || '',
          large_image_url: m.coverImage?.extraLarge || m.coverImage?.large || '',
        },
      },
      synopsis: stripAniListHtml(m.description || ''),
      background: '',
      score: typeof m.averageScore === 'number' ? m.averageScore / 10 : null,
      scored_by: null,
      rank: null,
      popularity: null,
      episodes: m.episodes || 0,
      status: m.status || '',
      type: m.format || 'TV',
      rating: '',
      source: '',
      duration: null,
      aired: { string: null },
      start_date: null,
      genres: (m.genres || []).map((g, i) => ({ mal_id: i, name: g })),
      studios: [],
      related_anime: [],
      recommendations: [],
      trailer: [],
      themes: [],
      members: 0,
      broadcast: { day: null, time: null },
      duration_mins: null,
      banner_image: m.bannerImage || undefined,
    }));
}

async function writeToKv(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}?expiration_ttl=7200`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'text/plain',
    },
    body: value,
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Cloudflare KV write failed: HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  console.log('Cloudflare KV write ok:', body.slice(0, 200));
}

async function main() {
  const { season, seasonYear } = currentSeason();
  console.log(`Fetching AniList season ${season} ${seasonYear}...`);
  const data = await fetchAniListSeason(season, seasonYear);

  if (data.length === 0) {
    console.error('AniList returned 0 usable entries — not overwriting existing cache.');
    process.exit(1);
  }

  console.log(`Got ${data.length} anime, ${data.filter((a) => a.banner_image).length} with a banner image.`);

  const key = `anilist_season_${season}_${seasonYear}`;
  await writeToKv(key, JSON.stringify({ data }));
  console.log(`Wrote ${key} to KV.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
