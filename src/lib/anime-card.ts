// Ports includes/anime_card.php. Takes a normalised anime object plus the
// viewer's list-status map (so "Add to List" vs "Edit in List" matches).
import { h } from './helpers';
import { icon } from './icons';
import { NormalisedAnime } from './mal-api';
import { DubStatus } from './dub-status';
import { Db } from './db';

const STATUS_LABELS: Record<string, string> = { watching: 'Watching', completed: 'Completed', plan_to_watch: 'Planning', dropped: 'Dropped', on_hold: 'On Hold' };
const STATUS_CLASSES: Record<string, string> = { watching: 'badge-watching', completed: 'badge-completed', plan_to_watch: 'badge-ptw', dropped: 'badge-dropped', on_hold: 'badge-onhold' };
export const LANG_CODE: Record<string, string> = { english: 'EN', hindi: 'HI', spanish: 'ES', german: 'DE', french: 'FR', portuguese: 'PT', italian: 'IT', korean: 'KO' };

export interface AnimeCardMeta { airedInfo?: null; dubbedLangs?: string[]; }

/** Batch-load non-image card metadata. Episode counts remain the Hoshika
 * catalog values already present on each anime object; legacy airing-count
 * cache entries must not override them. */
export async function buildCardMetaMap(db: Db, items: NormalisedAnime[]): Promise<Map<number, AnimeCardMeta>> {
  const ids = [...new Set(items.map((a) => a.mal_id).filter((id): id is number => !!id))];
  const out = new Map<number, AnimeCardMeta>();
  if (!ids.length) return out;
  const dubMap = await DubStatus.getForMany(db, ids);
  for (const id of ids) out.set(id, { airedInfo: null, dubbedLangs: dubMap.get(id) ?? [] });
  return out;
}

export function renderAnimeCard(a: NormalisedAnime, siteUrl: string, userStatus: string | null, meta?: AnimeCardMeta): string {
  const aid = a.mal_id ?? 0;
  const atitle = a.title_english && a.title_english !== a.title ? a.title_english : (a.title || 'Unknown');
  const aimg = a.images?.jpg?.image_url ?? '';
  // Cards display at ~224x336 CSS px, so TMDB's w500 is oversized. Serve w342
  // by default and let retina screens step up to w500 via srcset.
  const tmdb = aimg.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/.+)$/);
  const cardSrc = tmdb ? `${tmdb[1]}w342${tmdb[2]}` : aimg;
  const cardSrcSet = tmdb ? `${tmdb[1]}w342${tmdb[2]} 342w, ${tmdb[1]}w500${tmdb[2]} 500w` : '';
  const cardSizes = '(max-width: 768px) 38vw, 224px';
  const ascore = a.score;
  const atype = a.type ?? '';
  const aeps = a.episodes ?? 0;
  const aurl = `${siteUrl}/anime?id=${aid}`;

  const jTitle = JSON.stringify(atitle);
  const jImage = JSON.stringify(aimg);
  const inUserList = userStatus !== null;

  // Display only the Hoshika catalog's episode count.
  const epsLabel = aeps ? `${aeps} eps` : '';

  const dubbed = meta?.dubbedLangs ?? [];
  const hasDub = dubbed.length > 0;
  const audioItem = hasDub
    ? `<span class="anime-card-meta-item anime-card-meta-dub" title="Dubbed: ${h(dubbed.join(', '))}">${icon('mic', 'icon-inline')} Dub</span>`
    : `<span class="anime-card-meta-item">${icon('captions', 'icon-inline')} Sub</span>`;

  return `
<div class="anime-card" onclick="window.location.href='${h(aurl)}'">
  <div class="anime-card-poster">
    ${aimg
      ? `<img src="${h(cardSrc)}" alt="${h(atitle)}" loading="lazy" decoding="async"${cardSrcSet ? ` srcset="${h(cardSrcSet)}" sizes="${cardSizes}"` : ''}>`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:2rem;">${icon('user', 'icon-xl')}</div>`}
    ${ascore ? `<div class="anime-card-score">${icon('star', 'icon-small')} ${ascore.toFixed(1)}</div>` : ''}
    ${userStatus ? `<div class="anime-card-user-status badge ${STATUS_CLASSES[userStatus] ?? 'badge-default'}" data-anime-id="${aid}">${STATUS_LABELS[userStatus] ?? userStatus}</div>` : ''}
    <div class="anime-card-overlay">
      <button class="btn btn-primary btn-sm" onclick='event.stopPropagation(); addToList(${aid}, ${jTitle}, ${jImage}, ${Number(aeps)})'>
        ${inUserList ? '✏️ Edit in List' : `${icon('plus', 'icon-small')} Add to List`}
      </button>
    </div>
    <div class="anime-card-bottom-mobile">
      <button class="anime-card-add-mobile" onclick='event.stopPropagation(); addToList(${aid}, ${jTitle}, ${jImage}, ${Number(aeps)})' title="${inUserList ? 'Edit in List' : 'Add to List'}">
        ${inUserList ? icon('edit', 'icon-small') : '+'}
      </button>
      ${userStatus ? `<span class="anime-card-status-mobile badge ${STATUS_CLASSES[userStatus] ?? 'badge-default'}">${STATUS_LABELS[userStatus] ?? userStatus}</span>` : ''}
    </div>
  </div>
  <div class="anime-card-info">
    <div class="anime-card-title">${h(atitle)}</div>
    <div class="anime-card-meta">
      ${atype ? `<span class="anime-card-meta-item">${icon('tv', 'icon-inline')} ${h(atype)}</span>` : ''}
      ${epsLabel ? `<span class="anime-card-meta-item">${icon('list', 'icon-inline')} ${h(epsLabel)}</span>` : ''}
      ${audioItem}
    </div>
  </div>
</div>`;
}
