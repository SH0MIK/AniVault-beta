// Canonical "fixed server button" definitions shared between the watch
// page markup (watch.ts — renders the buttons server-side, always
// visible) and the player script (watch-script1.ts — resolves each
// button's actual stream in the background and wires up same-group
// fallback). Keeping this in one place means the button list rendered
// server-side and the resolution list used client-side can never drift
// out of sync with each other.
//
// One button per PROVIDER, not per source — a source with 4 providers
// (e.g. AnimeNoSub: Moon/Omega/Nova/Turbo) gets 4 separate fixed buttons,
// each hardcoded to that exact provider name and checking it directly.
// `provider` must be the EXACT string the scraper expects as its
// `server=` query param (case is handled server-side, but the text
// itself must match); `null` means the source has no server selector at
// all (AnimeHeaven only exposes one stream, no `server=` param needed).

export interface FixedProviderDef {
  source: string;
  provider: string | null;
  label: string;
}

// Sub tab.
export const SUB_PROVIDERS: FixedProviderDef[] = [
  // Current scraper backend exposes only AnimeHeaven + Anikoto for subtitles.
  // Leave provider selection to the scraper so this page never hardcodes
  // server names from the retired backend.
  { source: 'anikoto', provider: null, label: 'Anikoto' },
  { source: 'animeheaven', provider: null, label: 'AnimeHeaven' },
];

// English dub is currently provided by Anikoto in the new scraper backend.
export const DUB_PROVIDERS: FixedProviderDef[] = [
  { source: 'anikoto', provider: null, label: 'Anikoto' },
];

// Hindi/regional dub is provided by DesiDub in the new scraper backend.
export const HINDI_PROVIDERS: FixedProviderDef[] = [
  { source: 'desidub', provider: null, label: 'DesiDub' },
];

// AniZone + WatchAnimeWorld also carry OTHER languages (Tamil, Telugu,
// Spanish, ...) beyond English/Hindi — those stay fully dynamic (Multi
// Dub group, built per-anime, no fixed buttons, no fallback), per the
// explicit call not to combine/fallback multi-dub languages.
export const MULTI_LANG_SOURCES = ['anizone', 'watchanimeworld'];

function h(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Stable per-button id derived from source+provider — used as the
// data-server suffix so the button can be looked up again client-side.
// Slugged because provider names contain spaces/parens ("Sub - Moon",
// "Mirror (Muse)dub") that aren't safe inside an attribute-selector.
export function providerId(source: string, provider: string | null): string {
  const slug = (provider || source).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
  return `${source}__${slug}`;
}

// Server-rendered button markup. Every button exists in the HTML from
// the first response — nothing is created/removed by JS anymore. The
// `server-btn-pending` class shows a small spinner (see watch-css.ts)
// until the player script resolves (or fails to resolve) that EXACT
// provider in the background; `data-server` is the STABLE key
// (`fixed:<group>:<providerId>`) used for click handling + active-button
// highlighting, independent of which underlying provider ends up
// actually playing behind it once same-group fallback kicks in (see
// `data-real-server`, set by the player script). `data-fixed-key` stays
// the SOURCE (not the provider) purely so multiple providers from the
// same source share that source's accent color in watch-css.ts.
export function fixedServerBtn(group: string, source: string, provider: string | null, label: string): string {
  const id = providerId(source, provider);
  return `<button class="server-btn server-btn-pending" data-server="fixed:${h(group)}:${h(id)}" data-fixed-key="${h(source)}"><span class="server-btn-spin"></span>${h(label)}</button>`;
}
