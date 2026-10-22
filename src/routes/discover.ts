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
import { icon } from '../lib/icons';
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
  // The schedule should display exactly seven day groups, not an extra boundary-day group.
  const dayGroups = [...grouped.entries()].slice(0, 7);
  const initialDay = dayGroups.find(([day]) => day === fmtDay(new Date().toISOString()))?.[0] ?? dayGroups[0]?.[0] ?? '';
  const dayCount = (entries: any[]) => entries.length;
  html += `
<main class="container section schedule-page">
  <div class="flex-between mb-3" style="gap:1rem;flex-wrap:wrap;align-items:flex-start;">
    <div style="display:flex;gap:.75rem;align-items:center;">
      <div class="schedule-heading-icon" aria-hidden="true">${icon('calendar', 'icon-small')}</div>
      <div><h1 style="margin:0;">Schedule</h1><p class="text-muted" style="margin:.2rem 0 0;">This week's anime airings</p></div>
    </div>
    <button class="btn btn-ghost" id="schedule-filter-toggle" type="button" aria-expanded="false" aria-controls="schedule-filters">☷ Filters</button>
  </div>
  <div class="schedule-types" aria-label="Filter by anime type">
    ${['TV','ONA','Movie','OVA','Special','Music'].map(type => `<button type="button" class="schedule-chip" data-type-filter="${type.toUpperCase()}">${type}</button>`).join('')}
  </div>
  <section id="schedule-filters" class="card card-body" hidden style="margin:1rem 0;display:none;">
    <div class="schedule-filter-grid">
      <div><label class="schedule-filter-label">TIME FORMAT</label><div class="schedule-options"><button class="schedule-chip is-active" data-time-format="12" type="button">12H</button><button class="schedule-chip" data-time-format="24" type="button">24H</button></div></div>
      <div><label class="schedule-filter-label">SORT BY</label><div class="schedule-options"><button class="schedule-chip" data-sort="popularity" type="button">Popularity</button><button class="schedule-chip is-active" data-sort="time" type="button">Time</button><button class="schedule-chip" data-sort="az" type="button">A-Z</button></div></div>
      <div><label class="schedule-filter-label">IMAGES</label><div class="schedule-options"><button class="schedule-chip is-active" data-images="show" type="button">Show</button><button class="schedule-chip" data-images="hide" type="button">Hide</button></div></div>
      <div><label class="schedule-filter-label">◎ TIMEZONE</label><select id="schedule-timezone" class="form-control" style="width:100%;"><option value="local">Local</option><option value="Asia/Tokyo">Japan (JST)</option><option value="UTC">UTC</option></select></div>
    </div>
  </section>
  <nav class="schedule-week-nav" aria-label="Schedule week navigation">
    <a class="btn btn-ghost" href="${h(weekLink(week.prev))}">‹ Prev</a>
    <div style="text-align:center;"><strong>Week ${h(String(week.week ?? '—'))} · ${h(String(week.year ?? ''))}</strong><div class="text-muted" style="font-size:.82rem;margin-top:.2rem;">${week.startISO ? h(`${new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(week.startISO))} - ${new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(Date.parse(week.startISO)+6*86400000))}`) : ''} </div></div>
    <a class="btn btn-ghost" href="${h(weekLink(week.next))}">Next ›</a>
  </nav>
  <nav class="schedule-day-nav" aria-label="Choose airing day">
    ${dayGroups.map(([day, dayItems], index) => {
      const date = dayItems.find((item:any) => item.airingAt)?.airingAt;
      const d = date ? new Date(date) : null;
      const weekday = d ? new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',weekday:'short'}).format(d).toUpperCase() : day.slice(0,3).toUpperCase();
      const dayNum = d ? new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',day:'numeric'}).format(d) : '—';
      return `<button type="button" class="schedule-day-button ${day===initialDay?'is-active':''}" data-day-target="${h(day)}"><span>${h(weekday)}</span><strong>${h(dayNum)}</strong><small data-day-count>${dayCount(dayItems)}</small></button>`;
    }).join('')}
  </nav>
  ${loadError || payload?.ok === false ? '<div class="card card-body"><p>Could not load the schedule from Hoshika right now. Please try again shortly.</p></div>' : ''}
  ${!loadError && items.length === 0 ? '<div class="card card-body"><p>No airing episodes were found for this week.</p></div>' : ''}
  <div id="schedule-empty-filtered" class="card card-body" hidden>No episodes match these filters.</div>
  ${dayGroups.map(([day, dayItems]) => `
    <section class="schedule-day-section mb-4" data-day-section="${h(day)}" data-day-iso="${h(String(dayItems.find((item:any) => item.airingAt)?.airingAt ?? ''))}" ${day===initialDay?'':'hidden'}>
      <h2 style="font-size:1.15rem;margin-bottom:1rem;">${h(day)}</h2>
      <div class="schedule-episode-grid">
        ${dayItems.map((item: any) => {
          const title = String(item.titleLocalized || item.titleEnglish || item.titleRomaji || item.slug || 'Untitled anime');
          const image = typeof item.coverImage === 'string' ? item.coverImage : '';
          const id = encodeURIComponent(String(item.shortId ?? item.id ?? ''));
          const episode = Number.isFinite(Number(item.episode)) ? Number(item.episode) : null;
          const format = String(item.format || 'TV').trim().toUpperCase();
          const genres = Array.isArray(item.genres) ? item.genres.map((genre: any) => typeof genre === 'string' ? genre : String(genre?.name || genre?.title || '')).filter(Boolean).slice(0, 4) : [];
          return `<article class="card schedule-episode" data-title="${h(title.toLowerCase())}" data-format="${h(format)}" data-time="${h(String(item.airingAt ?? ''))}" data-popularity="${Number(item.averageScore)||0}" style="display:flex;gap:1rem;padding:.85rem;min-width:0;">
            <a class="schedule-cover" href="/anime/hoshika?id=${id}" style="flex:0 0 92px;align-self:flex-start;">
              ${image ? `<img src="${h(image)}" alt="" loading="lazy" style="display:block;width:92px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;">` : '<div class="anime-card-placeholder" style="width:92px;aspect-ratio:2/3;border-radius:8px;"></div>'}
            </a>
            <div style="min-width:0;flex:1;">
              <div class="text-muted schedule-airing-time" data-iso="${h(String(item.airingAt ?? ''))}" style="font-size:.82rem;margin-bottom:.35rem;">${h(fmtTime(String(item.airingAt ?? '')))}</div>
              <h3 style="font-size:1rem;line-height:1.4;margin:0 0 .4rem;"><a href="/anime/hoshika?id=${id}">${h(title)}</a></h3>
              <div class="text-muted" style="font-size:.85rem;">${episode !== null ? `Episode ${episode}` : 'Episode TBA'} · ${h(format)}</div>
              ${genres.length ? `<div class="schedule-genres">${genres.map((genre: string) => `<span class="schedule-genre">${h(genre)}</span>`).join('')}</div>` : ''}
            </div>
          </article>`;
        }).join('')}
      </div>
    </section>`).join('')}
</main>
<style>
.schedule-heading-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:var(--accent-glow);border:1px solid var(--border-accent);color:var(--accent);font-size:1.2rem;flex-shrink:0}.schedule-heading-icon svg{width:20px;height:20px;stroke:currentColor}.schedule-types,.schedule-options{display:flex;gap:.45rem;flex-wrap:wrap}.schedule-chip{border:1px solid var(--border,rgba(255,255,255,.12));background:transparent;color:inherit;border-radius:999px;padding:.35rem .8rem;font:inherit;font-size:.82rem;cursor:pointer}.schedule-chip.is-active{border-color:var(--accent,#a78bfa);background:var(--accent-glow,rgba(124,58,237,.18));color:var(--accent,#a78bfa)}.schedule-week-nav{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.7rem 1rem;margin:1rem 0;border:1px solid var(--border,rgba(255,255,255,.1));border-radius:999px;background:var(--bg-surface,rgba(255,255,255,.025))}.schedule-day-nav{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.45rem;margin:1.2rem 0 1.5rem}.schedule-day-button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15rem;min-height:72px;border:1px solid var(--border,rgba(255,255,255,.1));border-radius:22px;background:var(--bg-surface,rgba(255,255,255,.025));color:inherit;cursor:pointer}.schedule-day-button span{font-size:.72rem;font-weight:600}.schedule-day-button strong{font-size:1.1rem}.schedule-day-button small{font-size:.68rem;color:var(--text-muted,#999)}.schedule-day-button.is-active{border-color:var(--accent,#a78bfa);background:var(--accent-glow,rgba(124,58,237,.18))}.schedule-filter-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}.schedule-filter-label{display:block;font-size:.72rem;color:var(--text-muted,#999);margin-bottom:.55rem}.schedule-genres{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.65rem}.schedule-genre{display:inline-flex;border:1px solid var(--border,rgba(255,255,255,.12));border-radius:999px;padding:.2rem .55rem;color:var(--text-muted,#aaa);font-size:.72rem;line-height:1.4}.schedule-episode-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr));gap:1rem}.schedule-page [hidden]{display:none!important}@media(max-width:600px){.schedule-day-nav{gap:.25rem}.schedule-day-button{min-height:64px;border-radius:14px}.schedule-day-button span{font-size:.62rem}.schedule-day-button strong{font-size:1rem}.schedule-day-button small{font-size:.62rem}.schedule-filter-grid{grid-template-columns:1fr}.schedule-week-nav{border-radius:18px;padding:.6rem}.schedule-week-nav .btn{padding:.35rem .5rem}}
</style>
<script>
(function(){
 const root=document.querySelector('.schedule-page');if(!root)return;
 const filterButton=root.querySelector('#schedule-filter-toggle'),filters=root.querySelector('#schedule-filters');
 filterButton?.addEventListener('click',()=>{const open=filters.hidden;filters.hidden=!open;filters.style.display=open?'block':'none';filterButton.setAttribute('aria-expanded',String(open));});
 let selectedType='';let sort='time';let timeFormat='12';let timezone='local';let images='show';
 const buttons=[...root.querySelectorAll('[data-day-target]')],sections=[...root.querySelectorAll('[data-day-section]')];
 const localDayKey=date=>{const d=new Date(date);if(!Number.isFinite(d.getTime()))return '';return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
 const todayKey=localDayKey(Date.now());
 // A JST-labelled group can contain airings that fall on two different local dates.
 // Match every episode, not just the group's first airing, and avoid locale-formatted date strings.
 const todaySection=sections.find(section=>[...section.querySelectorAll('.schedule-episode')].some(card=>localDayKey(card.dataset.time)===todayKey));
 if(todaySection)buttons.forEach(button=>button.classList.toggle('is-active',button.dataset.dayTarget===todaySection.dataset.daySection));
 function apply(){let visible=0;sections.forEach(section=>{const active=buttons.find(b=>b.classList.contains('is-active'))?.dataset.dayTarget;const show=section.dataset.daySection===active;section.hidden=!show;const cards=[...section.querySelectorAll('.schedule-episode')];cards.forEach(card=>{const match=!selectedType||card.dataset.format===selectedType;card.hidden=!match;if(match)visible++;const cover=card.querySelector('.schedule-cover');if(cover)cover.hidden=images==='hide';});const grid=section.querySelector('.schedule-episode-grid');if(grid){cards.sort((a,b)=>sort==='az'?a.dataset.title.localeCompare(b.dataset.title):sort==='popularity'?Number(b.dataset.popularity)-Number(a.dataset.popularity):Date.parse(a.dataset.time)-Date.parse(b.dataset.time)).forEach(card=>grid.appendChild(card));}});const empty=root.querySelector('#schedule-empty-filtered');if(empty)empty.hidden=visible>0;root.querySelectorAll('.schedule-airing-time').forEach(el=>{const date=new Date(el.dataset.iso);if(!Number.isFinite(date.getTime()))return;const zone=timezone==='local'?undefined:timezone;el.textContent=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit',timeZoneName:'short',hour12:timeFormat==='12'}).format(date);});}
 buttons.forEach(button=>button.addEventListener('click',()=>{buttons.forEach(b=>b.classList.toggle('is-active',b===button));apply();}));
 root.querySelectorAll('[data-type-filter]').forEach(button=>button.addEventListener('click',()=>{selectedType=selectedType===button.dataset.typeFilter?'':button.dataset.typeFilter;root.querySelectorAll('[data-type-filter]').forEach(b=>b.classList.toggle('is-active',b.dataset.typeFilter===selectedType));apply();}));
 root.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{sort=button.dataset.sort;root.querySelectorAll('[data-sort]').forEach(b=>b.classList.toggle('is-active',b===button));apply();}));
 root.querySelectorAll('[data-time-format]').forEach(button=>button.addEventListener('click',()=>{timeFormat=button.dataset.timeFormat;root.querySelectorAll('[data-time-format]').forEach(b=>b.classList.toggle('is-active',b===button));apply();}));
 root.querySelectorAll('[data-images]').forEach(button=>button.addEventListener('click',()=>{images=button.dataset.images;root.querySelectorAll('[data-images]').forEach(b=>b.classList.toggle('is-active',b===button));apply();}));
 root.querySelector('#schedule-timezone')?.addEventListener('change',event=>{timezone=event.target.value;apply();});
 apply();
})();
</script>`;

  html += renderFooter({ siteUrl, currentUser: layoutUser });
  await session.save(c, lifetime);
  return c.html(html);
});
