// Ports pages/character.php. Unlike anime.php, this fetches everything
// server-side (character data, anime appearances, voice actors) since
// Jikan's character endpoints are cheap and there's no lazy-load pattern
// in the original.
//
// Redesigned to match the anime.ts / anivexa-theme.css "advanced" layout:
// blurred-backdrop hero with a floating portrait card (same recipe as
// anime.ts's ih-hero, just using the character's own image as the backdrop
// since there's no separate banner asset for characters), then an
// info-section body reusing the anime page's info-stats / scroll-row /
// row-nav components so the two detail pages feel like the same system.
import { Hono } from 'hono';
import type { Env } from '../index';
import { Db } from '../lib/db';
import { Session } from '../lib/session';
import { Auth } from '../lib/auth';
import { MalAPI } from '../lib/mal-api';
import { Notification } from '../lib/notification';
import { h } from '../lib/helpers';
import { icon } from '../lib/icons';
import { renderHeader, renderFooter, CurrentUser } from '../render/layout';
import { CHARACTER_CSS } from '../render/character-css';
import { getBannerData } from '../lib/settings';
import { rowNavScript } from '../render/home-js';

export const characterRoutes = new Hono<{ Bindings: Env }>();

characterRoutes.get('/character', async (c) => {
  const db = new Db(c.env.DB);
  const lifetime = Number(c.env.SESSION_LIFETIME_SECONDS ?? 86400);
  const session = await Session.load(c, db, lifetime);
  const auth = new Auth(db, session, c.env as any, c.req.header('cf-connecting-ip') ?? 'unknown');
  const mal = new MalAPI(c.env, c.env.API_CACHE, db);
  const siteUrl = c.env.SITE_URL;

  const charId = parseInt(c.req.query('id') ?? '0', 10) || 0;
  if (!charId) return c.redirect(siteUrl + '/');

  const { character: charData, animeography: charAnimeData, voices: charVoicesData } = await mal.getCharacterFull(charId);

  const char = charData?.data;
  if (!char) {
    return c.html(`<script>window.location.href=${JSON.stringify(siteUrl + '/')};</script>`);
  }

  const name = char.name ?? 'Unknown Character';
  const nameKanji = char.name_kanji ?? null;
  const nicknames: string[] = char.nicknames ?? [];
  const about: string | null = char.about ?? null;
  const note: string | null = char.note ?? null;
  const spoilers: string[] = char.spoilers ?? [];
  const favorites: number = char.favorites ?? 0;
  const imageLarge = char.images?.jpg?.image_url ?? '';

  const animeList = (charAnimeData?.data ?? []).slice(0, 12);
  const voiceList = charVoicesData?.data ?? [];

  // Language filter chips on the VA grid, ordered by how many entries each
  // language has (most first) so Japanese/English lead for the typical case.
  const langCounts = new Map<string, number>();
  for (const va of voiceList) {
    const lang = va.language ?? 'Unknown';
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
  const languages = [...langCounts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);

  const currentUser = auth.check() ? await auth.getCurrentUser() : null;
  const unreadCount = currentUser ? await Notification.unreadCount(db, currentUser.id) : 0;
  const layoutUser: CurrentUser | null = currentUser
    ? { id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url, role: currentUser.role }
    : null;

  const charOgDescription = about
    ? about.replace(/\s+/g, ' ').substring(0, 200)
    : `Character info, appearances & voice actors for ${name} on AniVault.`;

  const __banner = await getBannerData(db);
  let html = renderHeader({
    ...__banner,    siteUrl, siteName: c.env.SITE_NAME, pageTitle: name, currentPage: 'character', currentUser: layoutUser, unreadCount,
    requestUrl: c.req.url,
    ogData: {
      title: name, description: charOgDescription, image: imageLarge || `${siteUrl}/assets/img/site-img/icon.png`,
      image_width: imageLarge ? 400 : 512, image_height: imageLarge ? 600 : 512,
      url: `${siteUrl}/character?id=${charId}`, type: 'profile',
    },
  });

  html += `
<style>${CHARACTER_CSS}</style>

<section class="ch-hero">
  <div class="ch-bg${imageLarge ? '' : ' ch-bg-fallback'}" style="background-image:url('${h(imageLarge)}')"></div>
  <div class="ch-bg-scrim"></div>

  <div class="container ch-inner">
    <div class="ch-thumb-wrap">
      <div class="ch-thumb">
        ${imageLarge ? `<img src="${h(imageLarge)}" alt="${h(name)}" loading="eager">` : `<div class="ch-thumb-placeholder">${icon('user')}</div>`}
      </div>
    </div>

    <div class="ch-content">
      <div class="ch-eyebrow">Character</div>
      <h1 class="ch-title">${h(name)}</h1>
      ${nameKanji && nameKanji !== name ? `<div class="ch-subtitle">${h(nameKanji)}</div>` : ''}

      ${nicknames.length > 0 ? `<div class="ch-nicknames">${nicknames.map((n) => `<span class="ch-nickname-tag">"${h(n)}"</span>`).join('')}</div>` : ''}

      <div class="ch-meta-row">
        ${favorites ? `<span class="ch-meta-item ch-meta-fav">${icon('heart-filled', 'icon-inline')} ${favorites.toLocaleString('en-US')} favorites</span>` : ''}
        ${animeList.length > 0 ? `<span class="ch-meta-item">${icon('tv', 'icon-inline')} ${animeList.length} anime appearance${animeList.length !== 1 ? 's' : ''}</span>` : ''}
        ${voiceList.length > 0 ? `<span class="ch-meta-item">${icon('mic', 'icon-inline')} ${voiceList.length} voice actor${voiceList.length !== 1 ? 's' : ''}</span>` : ''}
      </div>
    </div>
  </div>
</section>

<div class="container ch-body">
  ${about ? `
  <div class="info-section">
    <div class="info-grid-2">
      <div>
        <h2 class="info-section-title">About</h2>
        <p class="ch-about" id="ch-about-text">${h(about).replace(/\n/g, '<br>')}</p>
        <button id="ch-about-toggle" class="ch-about-toggle" style="display:none;" type="button" onclick="var d=document.getElementById('ch-about-text'); d.classList.toggle('expanded'); this.textContent = d.classList.contains('expanded') ? 'Show less' : 'Show more';">Show more</button>
        <script>(function(){var d=document.getElementById('ch-about-text'),t=document.getElementById('ch-about-toggle'); if(d&&t&&d.scrollHeight>d.clientHeight+4){t.style.display='inline-block';}})();</script>

        ${spoilers.length > 0 ? `
        <div class="ch-spoilers">
          ${spoilers.map((s) => `
          <details class="ch-spoiler">
            <summary>Click to reveal spoiler</summary>
            <div class="ch-spoiler-body">${h(s)}</div>
          </details>`).join('')}
        </div>` : ''}

        ${note ? `<p class="ch-note">${h(note)}</p>` : ''}
      </div>
      <div>
        <h2 class="info-section-title">Character Info</h2>
        <div class="info-stats">
          ${infoStatRow('Name', name)}
          ${nameKanji && nameKanji !== name ? infoStatRow('Japanese Name', nameKanji) : ''}
          ${infoStatRow('Nicknames', nicknames.length > 0 ? nicknames.join(', ') : '—')}
          ${infoStatRow('Favorites', favorites ? favorites.toLocaleString('en-US') : '—')}
          ${infoStatRow('Anime Appearances', String(animeList.length))}
          ${infoStatRow('Voice Actors', String(voiceList.length))}
        </div>
      </div>
    </div>
  </div>` : ''}

  ${animeList.length > 0 ? `
  <div class="info-section">
    <div class="section-header">
      <h2 class="info-section-title" style="margin-bottom:0;">Appears In (${animeList.length})</h2>
      <div style="display:flex;align-items:center;gap:12px;">
        <button class="btn btn-ghost btn-sm btn-icon row-nav-btn" data-target="ch-anime-row" data-dir="prev" aria-label="Previous">${icon('chevron-left', 'icon-small')}</button>
        <button class="btn btn-ghost btn-sm btn-icon row-nav-btn" data-target="ch-anime-row" data-dir="next" aria-label="Next">${icon('chevron-right', 'icon-small')}</button>
      </div>
    </div>
    <div class="scroll-row" id="ch-anime-row">
      ${animeList.map((entry: any) => {
        const a = entry.anime ?? {};
        const aid = a.mal_id ?? 0;
        const atitle = a.title ?? 'Unknown';
        const aimg = a.images?.jpg?.image_url ?? '';
        const role = entry.role ?? '';
        const isMain = role.toLowerCase() === 'main';
        return `
      <a href="${siteUrl}/anime?id=${aid}" class="anime-card" style="text-decoration:none;">
        <div class="anime-card-poster" style="position:relative;">
          ${isMain ? `<span class="ch-role-badge">Main</span>` : ''}
          ${aimg ? `<img src="${h(aimg)}" alt="${h(atitle)}" loading="lazy">` : ''}
        </div>
        <div class="anime-card-info">
          <div class="anime-card-title">${h(atitle)}</div>
          <div class="anime-card-meta">${h(role)}</div>
        </div>
      </a>`;
      }).join('')}
    </div>
  </div>` : ''}

  ${voiceList.length > 0 ? `
  <div class="info-section">
    <h2 class="info-section-title">Voice Actors (${voiceList.length})</h2>
    ${languages.length > 1 ? `
    <div class="ch-lang-filters" id="ch-lang-filters">
      <button class="ch-lang-chip active" data-lang="all" onclick="chFilterLang('all')">All</button>
      ${languages.map((lang) => `<button class="ch-lang-chip" data-lang="${h(lang)}" onclick="chFilterLang(${JSON.stringify(lang)})">${h(lang)}</button>`).join('')}
    </div>` : ''}
    <div class="va-grid" id="ch-va-grid">
      ${voiceList.map((va: any) => {
        const person = va.person ?? {};
        const vaName = person.name ?? 'Unknown';
        const vaImg = person.images?.jpg?.image_url ?? '';
        const vaLang = va.language ?? 'Unknown';
        const vaUrl = person.url ?? '';
        const avatarHtml = vaImg
          ? `<img src="${h(vaImg)}" alt="${h(vaName)}" class="va-avatar" loading="lazy">`
          : `<div class="va-avatar-placeholder">${icon('mic')}</div>`;
        const inner = `<div class="va-avatar-wrap">${avatarHtml}</div><div class="va-name">${h(vaName)}</div><div class="va-lang">${h(vaLang)}</div>`;
        return `
      <div class="va-grid-item va-visible" data-lang="${h(vaLang)}">
        ${vaUrl
          ? `<a href="${h(vaUrl)}" target="_blank" rel="noopener" class="va-card">${inner}</a>`
          : `<div class="va-card">${inner}</div>`}
      </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  ${animeList.length === 0 && voiceList.length === 0 ? `<p class="text-muted text-center" style="padding:2rem 0;">No additional information available for this character.</p>` : ''}
</div>
${rowNavScript()}

<script>
function chFilterLang(lang) {
    var chips = document.querySelectorAll('#ch-lang-filters .ch-lang-chip');
    chips.forEach(function(c) { c.classList.toggle('active', c.dataset.lang === lang); });
    var items = document.querySelectorAll('#ch-va-grid .va-grid-item');
    items.forEach(function(item) {
        var show = lang === 'all' || item.dataset.lang === lang;
        item.classList.toggle('va-visible', show);
    });
}
</script>`;

  html += renderFooter({ siteUrl, currentUser: layoutUser });
  await session.save(c, lifetime);
  return c.html(html);
});

function infoStatRow(label: string, value: string): string {
  return `<div class="info-stat-row"><span class="label">${h(label)}</span><span class="value">${h(value)}</span></div>`;
}
