// Legacy /anime?id=<old MAL ID> entry point. Canonical anime pages use
// Hoshika short IDs at /anime/hoshika?id=<shortId>. Never interpret a legacy
// numeric ID as a Hoshika ID or fetch fallback catalog metadata.
import { Hono } from 'hono';
import type { Env } from '../index';
import { Db } from '../lib/db';
import { Session } from '../lib/session';
import { Auth } from '../lib/auth';
import { Notification } from '../lib/notification';
import { findIdentityByLegacyMalId } from '../lib/anime-identity';
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
