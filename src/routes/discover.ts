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
discoverRoutes.get('/schedule', async (c) => {
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
  const requestedYear = Number.parseInt(c.req.query('year') ?? '', 10);
  const requestedWeek = Number.parseInt(c.req.query('week') ?? '', 10);
  const scheduleUrl = new URL('https://hoshika.app/api/v1/schedule');
  if (Number.isInteger(requestedYear) && requestedYear >= 1900 && requestedYear <= 2200) scheduleUrl.searchParams.set('year', String(requestedYear));
  if (Number.isInteger(requestedWeek) && requestedWeek >= 1 && requestedWeek <= 53) scheduleUrl.searchParams.set('week', String(requestedWeek));

  let payload: any = null;
  let loadError = false;
  try {
    const response = await fetch(scheduleUrl.toString(), { headers: { Accept: 'application/json' } });
    if (response.ok) payload = await response.json();
    else loadError = true;
  } catch (error) {
    console.warn('[schedule] Hoshika schedule request failed:', String(error));
    loadError = true;
  }

  const week = payload?.week ?? {};
  const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
  const weekLink = (target: any) => {
    const year = Number(target?.year);
    const weekNo = Number(target?.week);
    return Number.isInteger(year) && Number.isInteger(weekNo)
      ? `/schedule?year=${year}&week=${weekNo}`
      : '/schedule';
  };
  const fmtDay = (value: string) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Upcoming';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'long', month: 'short', day: 'numeric' }).format(date);
  };
  const fmtTime = (value: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)
      : 'Time TBA';
  };
  const grouped = new Map<string, any[]>();
  for (const item of [...items].sort((a, b) => Date.parse(a.airingAt ?? '') - Date.parse(b.airingAt ?? ''))) {
    const key = item?.airingAt ? fmtDay(item.airingAt) : 'Time TBA';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }
  let html = renderHeader({
    ...banner, siteUrl, siteName: c.env.SITE_NAME, pageTitle: 'Anime Schedule',
    currentPage: 'schedule', currentUser: layoutUser, unreadCount, requestUrl: c.req.url,
  });
  html += `
<main class="container section">
  <div class="flex-between mb-3" style="gap:1rem;flex-wrap:wrap;">
    <div><h1>Anime Schedule</h1><p class="text-muted">Upcoming episodes · Japan Standard Time (JST)</p></div>
    <div style="display:flex;gap:.5rem;align-items:center;">
      <a class="btn btn-ghost" href="${h(weekLink(week.prev))}" aria-label="Previous week">← Previous</a>
      <a class="btn btn-ghost" href="/schedule">Current week</a>
      <a class="btn btn-ghost" href="${h(weekLink(week.next))}" aria-label="Next week">Next →</a>
    </div>
  </div>
  ${week.year && week.week ? `<p class="text-muted mb-3">Week ${h(String(week.week))}, ${h(String(week.year))}</p>` : ''}
  ${loadError || payload?.ok === false ? '<div class="card card-body"><p>Could not load the schedule from Hoshika right now. Please try again shortly.</p></div>' : ''}
  ${!loadError && items.length === 0 ? '<div class="card card-body"><p>No airing episodes were found for this week.</p></div>' : ''}
  ${[...grouped.entries()].map(([day, dayItems]) => `
    <section class="mb-4">
      <h2 style="font-size:1.15rem;margin-bottom:1rem;">${h(day)}</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr));gap:1rem;">
        ${dayItems.map((item: any) => {
          const title = String(item.titleLocalized || item.titleEnglish || item.titleRomaji || item.slug || 'Untitled anime');
          const image = typeof item.coverImage === 'string' ? item.coverImage : '';
          const id = encodeURIComponent(String(item.shortId ?? item.id ?? ''));
          const episode = Number.isFinite(Number(item.episode)) ? Number(item.episode) : null;
          const platforms = Array.isArray(item.platforms) ? item.platforms.filter((p: any) => p && typeof p.url === 'string' && /^https?:\\/\\//i.test(p.url)) : [];
          return `<article class="card" style="display:flex;gap:1rem;padding:.85rem;min-width:0;">
            <a href="/anime/hoshika?id=${id}" style="flex:0 0 92px;align-self:flex-start;">
              ${image ? `<img src="${h(image)}" alt="" loading="lazy" style="display:block;width:92px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;">` : '<div class="anime-card-placeholder" style="width:92px;aspect-ratio:2/3;border-radius:8px;"></div>'}
            </a>
            <div style="min-width:0;flex:1;">
              <div class="text-muted" style="font-size:.82rem;margin-bottom:.35rem;">${h(fmtTime(String(item.airingAt ?? '')))}</div>
              <h3 style="font-size:1rem;line-height:1.4;margin:0 0 .4rem;"><a href="/anime/hoshika?id=${id}">${h(title)}</a></h3>
              <div class="text-muted" style="font-size:.85rem;">${episode !== null ? `Episode ${episode}` : 'Episode TBA'}${item.format ? ` · ${h(String(item.format))}` : ''}</div>
              ${platforms.length ? `<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.7rem;">${platforms.slice(0,4).map((p: any) => `<a class="btn btn-ghost" style="font-size:.78rem;padding:.3rem .5rem;" href="${h(p.url)}" target="_blank" rel="noopener noreferrer">${h(String(p.name || 'Watch'))}</a>`).join('')}</div>` : ''}
            </div>
          </article>`;
        }).join('')}
      </div>
    </section>`).join('')}
</main>`;
  html += renderFooter({ siteUrl, currentUser: layoutUser });
  await session.save(c, lifetime);
  return c.html(html);
});
