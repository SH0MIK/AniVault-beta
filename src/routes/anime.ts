// Legacy /anime?id=<old MAL ID> entry point. Canonical anime pages use
// Hoshika short IDs at /anime/hoshika?id=<shortId>. Never interpret a legacy
// numeric ID as a Hoshika ID or fetch fallback catalog metadata.
import { Hono } from 'hono';
import type { Env } from '../index';
import { Db } from '../lib/db';
import { Session } from '../lib/session';
import { Auth } from '../lib/auth';
import { Notification } from '../lib/notification';
import { findIdentityByLegacyMalId, findIdentityByHoshikaId } from '../lib/anime-identity';
import { getHoshikaAnimeById } from '../lib/hoshika-api';
import { h } from '../lib/helpers';
import { renderHeader, renderFooter, CurrentUser } from '../render/layout';
import { getBannerData } from '../lib/settings';

export const animeRoutes = new Hono<{ Bindings: Env }>();

animeRoutes.get('/anime', async (c) => {
  const db = new Db(c.env.DB);
  const lifetime = Number(c.env.SESSION_LIFETIME_SECONDS ?? 86400);
  const session = await Session.load(c, db, lifetime);
  const auth = new Auth(db, session, c.env as any, c.req.header('cf-connecting-ip') ?? 'unknown');
  const siteUrl = c.env.SITE_URL;
  const id = parseInt(c.req.query('id') ?? '0', 10) || 0;
  if (!id) {
    await session.save(c, lifetime);
    return c.redirect(siteUrl + '/');
  }

  const identity = await findIdentityByLegacyMalId(db, id).catch(() => null);
  await session.save(c, lifetime);
  if (identity?.verified === 1 && identity.hoshika_short_id) {
    return c.redirect(`${siteUrl}/anime/hoshika?id=${encodeURIComponent(identity.hoshika_short_id)}`, 302);
  }

  const currentUser = auth.check() ? await auth.getCurrentUser() : null;
  const unreadCount = currentUser ? await Notification.unreadCount(db, currentUser.id) : 0;
  const layoutUser: CurrentUser | null = currentUser
    ? { id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url, role: currentUser.role }
    : null;
  const banner = await getBannerData(db);
  let html = renderHeader({
    ...banner, siteUrl, siteName: c.env.SITE_NAME, pageTitle: 'Anime mapping required',
    currentPage: 'browse', currentUser: layoutUser, unreadCount, requestUrl: c.req.url,
    ogData: {
      title: 'Anime mapping required | AniVault',
      description: 'This legacy anime ID has not been verified against Hoshika yet.',
      url: c.req.url, type: 'website',
    },
  });
  html += `
<main class="container section" style="max-width:760px;margin:4rem auto;text-align:center;">
  <h1>Anime mapping required</h1>
  <p class="text-muted" style="line-height:1.7;margin:1rem 0 1.5rem;">
    This older AniVault link uses a legacy ID that has not been verified against Hoshika yet.
    We won't guess the mapping because it could open the wrong anime or streaming links.
  </p>
  <a class="btn btn-primary" href="${h(siteUrl)}/browse">Search the Hoshika catalog</a>
</main>`;
  html += renderFooter({ siteUrl, currentUser: layoutUser });
  return c.html(html);
});


// Canonical Hoshika-native detail page. The short ID is never treated as a
// legacy MAL ID; playback links are shown only for a verified identity mapping.
animeRoutes.get('/anime/hoshika', async (c) => {
  const db = new Db(c.env.DB);
  const lifetime = Number(c.env.SESSION_LIFETIME_SECONDS ?? 86400);
  const session = await Session.load(c, db, lifetime);
  const auth = new Auth(db, session, c.env as any, c.req.header('cf-connecting-ip') ?? 'unknown');
  const siteUrl = c.env.SITE_URL;
  const shortId = (c.req.query('id') ?? '').trim();
  if (!shortId) {
    await session.save(c, lifetime);
    return c.redirect(siteUrl + '/browse');
  }

  const [anime, identity] = await Promise.all([
    getHoshikaAnimeById(shortId),
    findIdentityByHoshikaId(db, shortId).catch(() => null),
  ]);
  const currentUser = auth.check() ? await auth.getCurrentUser() : null;
  const unreadCount = currentUser ? await Notification.unreadCount(db, currentUser.id) : 0;
  const layoutUser: CurrentUser | null = currentUser
    ? { id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url, role: currentUser.role }
    : null;
  const banner = await getBannerData(db);

  if (!anime) {
    await session.save(c, lifetime);
    let html = renderHeader({
      ...banner, siteUrl, siteName: c.env.SITE_NAME, pageTitle: 'Anime not found',
      currentPage: 'browse', currentUser: layoutUser, unreadCount, requestUrl: c.req.url,
    });
    html += `
<main class="container section" style="max-width:760px;margin:4rem auto;text-align:center;">
  <h1>Anime not found</h1>
  <p class="text-muted">Hoshika couldn't find this catalog entry.</p>
  <a class="btn btn-primary" href="${h(siteUrl)}/browse">Search anime</a>
</main>`;
    html += renderFooter({ siteUrl, currentUser: layoutUser });
    return c.html(html, 404);
  }

  const mappedLegacyId = identity?.verified === 1 && identity.legacy_mal_id && identity.legacy_mal_id > 0
    ? Number(identity.legacy_mal_id)
    : null;
  const title = anime.title || anime.titleEnglish || anime.titleRomaji || 'Untitled anime';
  const poster = anime.poster || anime.cover || '';
  const cover = anime.cover || anime.poster || '';
  const meta = [anime.type, anime.year ? String(anime.year) : '', anime.status,
    anime.episodes ? `${anime.episodes} episodes` : 'Episode count unavailable',
    anime.score !== null ? `★ ${anime.score.toFixed(1)}` : ''].filter(Boolean).map(h).join(' · ');
  const genres = anime.genres.map((genre) => `<span class="badge">${h(genre)}</span>`).join(' ');
  const watchUrl = mappedLegacyId && (anime.episodes ?? 0) > 0
    ? `${h(siteUrl)}/watch?anime=${mappedLegacyId}&amp;ep=1`
    : '';
  await session.save(c, lifetime);

  let html = renderHeader({
    ...banner, siteUrl, siteName: c.env.SITE_NAME, pageTitle: title,
    currentPage: 'browse', currentUser: layoutUser, unreadCount, requestUrl: c.req.url,
    ogData: {
      title, description: anime.synopsis || `Details for ${title}`,
      image: poster || undefined, url: c.req.url, type: 'website',
    },
  });
  html += `
<main class="container section" style="max-width:1100px;margin:2rem auto;">
  <div style="display:grid;grid-template-columns:minmax(150px,260px) minmax(0,1fr);gap:2rem;align-items:start;">
    <div>
      ${poster ? `<img src="${h(poster)}" alt="${h(title)}" style="display:block;width:100%;border-radius:12px;object-fit:cover;" loading="eager">` : '<div class="anime-card-placeholder" style="aspect-ratio:2/3;border-radius:12px;"></div>'}
    </div>
    <section>
      <p class="text-muted" style="font-size:.9rem;">Hoshika catalog</p>
      <h1 style="margin:.25rem 0 1rem;">${h(title)}</h1>
      ${anime.titleEnglish && anime.titleEnglish !== title ? `<p class="text-muted">${h(anime.titleEnglish)}</p>` : ''}
      <p class="text-muted" style="line-height:1.7;">${h(meta)}</p>
      ${genres ? `<div style="display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0;">${genres}</div>` : ''}
      ${anime.synopsis ? `<h2 style="font-size:1.15rem;margin-top:1.5rem;">Synopsis</h2><p style="line-height:1.8;white-space:pre-line;">${h(anime.synopsis)}</p>` : ''}
      ${watchUrl ? `<a class="btn btn-primary" style="display:inline-block;margin-top:1.25rem;" href="${watchUrl}">Watch Episode 1</a>` : `<p class="text-muted" style="margin-top:1.25rem;">Streaming is available only after this Hoshika entry has a verified AniVault identity mapping. No ID is guessed.</p>`}
      <p class="text-muted" style="font-size:.8rem;margin-top:1rem;">Hoshika ID: ${h(anime.shortId)}</p>
    </section>
  </div>
  ${cover && cover !== poster ? `<div style="margin-top:2rem;"><img src="${h(cover)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:12px;" loading="lazy"></div>` : ''}
</main>`;
  html += renderFooter({ siteUrl, currentUser: layoutUser });
  return c.html(html);
});
