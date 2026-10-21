import { Hono } from 'hono';
import type { Env } from '../index';
import { Db } from '../lib/db';
import { Session } from '../lib/session';
import { Auth } from '../lib/auth';
import { Notification } from '../lib/notification';
import { findIdentityByHoshikaId, rememberHoshikaIdentity } from '../lib/anime-identity';
import { getHoshikaAnimeById, getHoshikaAnimeEpisodesById } from '../lib/hoshika-api';
import { h } from '../lib/helpers';
import { renderHeader, renderFooter, CurrentUser } from '../render/layout';
import { getBannerData } from '../lib/settings';

export const hoshikaAnimeRoutes = new Hono<{ Bindings: Env }>();

hoshikaAnimeRoutes.get('/anime/hoshika', async (c) => {
  const id = (c.req.query('id') ?? '').trim();
  const siteUrl = c.env.SITE_URL;
  const db = new Db(c.env.DB);
  const lifetime = Number(c.env.SESSION_LIFETIME_SECONDS ?? 86400);
  const session = await Session.load(c, db, lifetime);
  const auth = new Auth(db, session, c.env as any, c.req.header('cf-connecting-ip') ?? 'unknown');
  const currentUser = auth.check() ? await auth.getCurrentUser() : null;
  const unreadCount = currentUser ? await Notification.unreadCount(db, currentUser.id) : 0;
  const layoutUser: CurrentUser | null = currentUser
    ? { id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url, role: currentUser.role }
    : null;
  const banner = await getBannerData(db);

  if (!id) {
    await session.save(c, lifetime);
    return c.redirect(`${siteUrl}/browse`);
  }

  const anime = await getHoshikaAnimeById(id);
  if (!anime) {
    const html = renderHeader({ ...banner, siteUrl, siteName: c.env.SITE_NAME, pageTitle: 'Anime unavailable', currentPage: 'browse', currentUser: layoutUser, unreadCount, requestUrl: c.req.url })
      + '<main class="container section"><h1>Anime unavailable</h1><p class="text-muted">Hoshika could not return this title. Please try again.</p><a class="btn btn-primary" href="/browse">Back to browse</a></main>'
      + renderFooter({ siteUrl, currentUser: layoutUser });
    await session.save(c, lifetime);
    return c.html(html, 404);
  }

  // Save only Hoshika identity metadata; never infer a MAL mapping from title.
  await rememberHoshikaIdentity(db, { shortId: anime.shortId, id: anime.id, slug: anime.slug, title: anime.title }).catch(() => undefined);
  const [episodes, identity] = await Promise.all([
    getHoshikaAnimeEpisodesById(anime.shortId),
    findIdentityByHoshikaId(db, anime.shortId),
  ]);
  const legacyWatchId = identity?.verified === 1 ? identity.legacy_mal_id : null;
  const title = h(anime.title);
  const poster = h(anime.poster || anime.cover);
  const synopsis = h(anime.synopsis || 'No synopsis is available from Hoshika.');
  const episodesHtml = (episodes ?? []).map((ep) => {
    const epTitle = h(ep.title || `Episode ${ep.number}`);
    const thumb = h(ep.thumbnail || '');
    const action = legacyWatchId
      ? `<a class="btn btn-primary btn-sm" href="/watch?anime=${legacyWatchId}&ep=${ep.number}">Watch</a>`
      : '<span class="text-muted" style="font-size:.8rem;">Streaming link not mapped yet</span>';
    return `<article class="card" style="display:flex;gap:12px;align-items:center;padding:10px;margin-bottom:8px;">
      ${thumb ? `<img src="${thumb}" alt="" loading="lazy" style="width:112px;aspect-ratio:16/9;object-fit:cover;border-radius:6px;">` : ''}
      <div style="flex:1;min-width:0;"><strong>Episode ${ep.number}</strong><div>${epTitle}</div></div>
      ${action}
    </article>`;
  }).join('');

  const html = renderHeader({ ...banner, siteUrl, siteName: c.env.SITE_NAME, pageTitle: anime.title, currentPage: 'browse', currentUser: layoutUser, unreadCount, requestUrl: c.req.url })
    + `<main class="container section">
      <a href="/browse" class="text-muted">← Browse anime</a>
      <section style="display:grid;grid-template-columns:minmax(120px,220px) minmax(0,1fr);gap:24px;margin:20px 0 30px;align-items:start;">
        ${poster ? `<img src="${poster}" alt="" style="width:100%;border-radius:10px;object-fit:cover;" loading="eager">` : '<div class="card" style="aspect-ratio:2/3;"></div>'}
        <div><p class="text-muted" style="font-size:.8rem;">HOSHIKA CATALOG</p><h1 style="margin:0 0 12px;">${title}</h1>
          <div class="text-muted" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
            ${anime.type ? `<span>${h(anime.type)}</span>` : ''}
            ${anime.year ? `<span>${anime.year}</span>` : ''}
            ${anime.episodes ? `<span>${anime.episodes} episodes</span>` : ''}
            ${anime.status ? `<span>${h(anime.status)}</span>` : ''}
          </div>
          ${anime.genres.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">${anime.genres.map(g => `<span class="filter-pill">${h(g)}</span>`).join('')}</div>` : ''}
          <p style="line-height:1.7;white-space:pre-line;">${synopsis}</p>
          ${!legacyWatchId ? '<p class="text-muted" style="font-size:.85rem;margin-top:14px;">This title uses a Hoshika ID. Existing streaming servers will appear after its legacy ID mapping is verified.</p>' : ''}
        </div>
      </section>
      <section><h2 style="margin-bottom:14px;">Episodes ${episodes ? `<span class="text-muted" style="font-size:.9rem;">(${episodes.length})</span>` : ''}</h2>
        ${episodesHtml || '<p class="text-muted">Episode data is temporarily unavailable from Hoshika.</p>'}
      </section>
    </main>
    <style>@media(max-width:600px){main section[style*="grid-template-columns"]{grid-template-columns:110px minmax(0,1fr)!important;gap:14px!important;}}</style>`
    + renderFooter({ siteUrl, currentUser: layoutUser });
  await session.save(c, lifetime);
  return c.html(html);
});
