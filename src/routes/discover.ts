// Hoshika currently exposes title search and anime details, but no confirmed
// seasonal, ranking, or schedule listing endpoints. These pages intentionally
// show a clear notice instead of falling back to MAL/Jikan/AniList.
import { Hono } from 'hono';
import type { Env } from '../index';
import { Db } from '../lib/db';
import { Session } from '../lib/session';
import { Auth } from '../lib/auth';
import { Notification } from '../lib/notification';
import { h } from '../lib/helpers';
import { renderHeader, renderFooter, CurrentUser } from '../render/layout';
import { getBannerData } from '../lib/settings';

export const discoverRoutes = new Hono<{ Bindings: Env }>();

async function unavailablePage(c: any, title: string, view: string) {
  const db = new Db(c.env.DB);
  const lifetime = Number(c.env.SESSION_LIFETIME_SECONDS ?? 86400);
  const session = await Session.load(c, db, lifetime);
  const auth = new Auth(db, session, c.env as any, c.req.header('cf-connecting-ip') ?? 'unknown');
  const siteUrl = c.env.SITE_URL;
  const currentUser = auth.check() ? await auth.getCurrentUser() : null;
  const unreadCount = currentUser ? await Notification.unreadCount(db, currentUser.id) : 0;
  const layoutUser: CurrentUser | null = currentUser
    ? { id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url, role: currentUser.role }
    : null;
  const banner = await getBannerData(db);
  let html = renderHeader({
    ...banner, siteUrl, siteName: c.env.SITE_NAME, pageTitle: title,
    currentPage: view, currentUser: layoutUser, unreadCount, requestUrl: c.req.url,
  });
  html += `
<main class="container section" style="max-width:760px;margin:3rem auto;">
  <h1>${h(title)}</h1>
  <p class="text-muted" style="line-height:1.7;margin:1rem 0;">
    Hoshika's confirmed public API doesn't currently provide ${h(view)} listings.
    AniVault won't substitute catalogue data from MAL, Jikan, or AniList.
  </p>
  <a class="btn btn-primary" href="${h(siteUrl)}/browse">Search anime</a>
</main>`;
  html += renderFooter({ siteUrl, currentUser: layoutUser });
  await session.save(c, lifetime);
  return c.html(html);
}

discoverRoutes.get('/seasonal', (c) => unavailablePage(c, 'Seasonal anime', 'seasonal anime'));
discoverRoutes.get('/top', (c) => unavailablePage(c, 'Top anime', 'top anime'));
discoverRoutes.get('/schedule', (c) => unavailablePage(c, 'Anime schedule', 'anime schedule'));
