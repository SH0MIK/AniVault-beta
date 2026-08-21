export const CHARACTER_CSS = `/* ── Character page — Anivexa-style layout (matches anime.ts's ih-hero / info-section system) ── */

/* -- Hero: blurred backdrop from the character's own portrait, scrim, floating card -- */
.ch-hero { position: relative; width: 100%; overflow: hidden; padding-top: var(--header-h); }
.ch-bg { position: absolute; inset: 0; background-position: center 20%; background-size: cover; background-repeat: no-repeat; filter: brightness(.4) blur(3px); transform: scale(1.05); }
.ch-bg-fallback { filter: brightness(.32) blur(6px); }
.ch-bg-scrim { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 20%, rgba(0,0,0,.35), rgba(0,0,0,.88) 65%, var(--bg-base) 100%); pointer-events: none; }

.ch-inner { position: relative; z-index: 2; display: flex; gap: 40px; align-items: flex-start; padding: 40px 0 48px; }
.ch-thumb-wrap { flex: 0 0 220px; width: 220px; position: relative; }
.ch-thumb { width: 100%; aspect-ratio: 3/4; border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08); background: var(--bg-card); }
.ch-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ch-thumb-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 3.5rem; color: var(--text-muted); background: var(--bg-card); }

.ch-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
.ch-eyebrow { font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--accent-2); }
.ch-title { font-size: clamp(1.6rem, 3.4vw, 2.5rem); font-weight: 800; line-height: 1.12; margin: 2px 0; text-shadow: 0 6px 24px rgba(0,0,0,.6); color: #fff; }
.ch-subtitle { font-size: .9rem; color: rgba(255,255,255,.55); font-weight: 500; }

.ch-nicknames { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.ch-nickname-tag { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); padding: 5px 14px; border-radius: var(--radius-pill); font-size: .78rem; font-weight: 600; font-style: italic; color: rgba(255,255,255,.85); }

.ch-meta-row { display: flex; flex-wrap: wrap; gap: 4px 18px; align-items: center; font-size: .85rem; font-weight: 600; color: rgba(255,255,255,.85); margin-top: 4px; }
.ch-meta-item { display: inline-flex; align-items: center; gap: 6px; }
.ch-meta-item .icon-inline { width: 14px; height: 14px; }
.ch-meta-fav { color: var(--gold); }

/* -- Body sections (reuses anime page's info-section / info-stats system) -- */
.ch-body { padding: 40px 0 72px; }
.ch-body .info-section { margin-bottom: 44px; }

.ch-about { font-size: .94rem; line-height: 1.8; color: var(--text-secondary); margin: 0; position: relative; max-height: 12.5em; overflow: hidden; transition: max-height .35s ease; white-space: pre-line; }
.ch-about.expanded { max-height: 200em; }
.ch-about::after { content: ''; position: absolute; inset: auto 0 0 0; height: 3em; background: linear-gradient(180deg, transparent 0%, var(--bg-base) 100%); pointer-events: none; transition: opacity .3s ease; }
.ch-about.expanded::after { opacity: 0; }
.ch-about-toggle { display: inline-block; margin-top: 10px; color: var(--accent-2); font-weight: 700; font-size: .85rem; cursor: pointer; background: none; border: none; padding: 0; }
.ch-note { font-size: .8rem; color: var(--text-muted); font-style: italic; margin: 14px 0 0; }

.ch-spoilers { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; }
.ch-spoiler { border: 1px solid var(--border); border-radius: var(--radius-md); background: rgba(255,255,255,.02); padding: 10px 14px; }
.ch-spoiler summary { cursor: pointer; font-size: .8rem; font-weight: 600; color: var(--text-muted); list-style: none; display: flex; align-items: center; gap: 8px; }
.ch-spoiler summary::-webkit-details-marker { display: none; }
.ch-spoiler summary::before { content: '⚠'; color: var(--gold); }
.ch-spoiler[open] summary { color: var(--text-secondary); margin-bottom: 8px; }
.ch-spoiler-body { font-size: .87rem; line-height: 1.7; color: var(--text-secondary); }

/* Info stats panel (right column) — same component the anime page uses */
.ch-stats-note { margin-top: 14px; font-size: .74rem; color: var(--text-muted); }

/* -- Voice actor language filter chips -- */
.ch-lang-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
.ch-lang-chip { background: rgba(255,255,255,.04); border: 1px solid var(--border); padding: 6px 15px; border-radius: var(--radius-pill); font-size: .78rem; font-weight: 600; color: var(--text-secondary); cursor: pointer; transition: var(--trans); }
.ch-lang-chip:hover { background: rgba(255,255,255,.08); color: var(--text-primary); }
.ch-lang-chip.active { background: var(--grad-accent); border-color: transparent; color: #fff; box-shadow: 0 0 16px var(--accent-glow); }

/* Voice actor cards — circular avatar, reuses .anime-card.char-card treatment */
.va-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 18px; }
.va-grid-item { display: none; }
.va-grid-item.va-visible { display: block; }
.va-card { text-decoration: none; display: block; text-align: center; transition: var(--trans); }
.va-card:hover .va-avatar, .va-card:hover .va-avatar-placeholder { transform: scale(1.06); box-shadow: 0 0 0 3px var(--border-accent); }
.va-avatar-wrap { aspect-ratio: 1/1; border-radius: 50%; overflow: hidden; border: 2px solid rgba(255,255,255,.08); margin: 0 auto 10px; width: 84px; }
.va-avatar { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s ease, box-shadow .3s ease; }
.va-avatar-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; color: var(--text-muted); background: var(--bg-card); transition: transform .3s ease, box-shadow .3s ease; border-radius: 50%; }
.va-name { font-size: .83rem; font-weight: 700; color: var(--text-primary); line-height: 1.3; }
.va-lang { font-size: .72rem; color: var(--text-muted); margin-top: 3px; }

/* Anime appearances — standard .anime-card poster inside a scroll-row (same component as anime.ts's related/characters rows) */
.ch-role-badge { position: absolute; top: 6px; left: 6px; background: var(--accent); color: #fff; font-size: .65rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: .04em; z-index: 2; }

@media (max-width: 880px) {
  .ch-inner { flex-direction: column; align-items: center; text-align: left; padding: 24px 12px 36px; gap: 16px; }
  .ch-thumb-wrap { width: min(170px, 45vw); align-self: center; }
  .ch-content { align-items: flex-start; width: 100%; gap: 8px; }
  .ch-meta-row, .ch-nicknames { justify-content: flex-start; }
  .ch-body { padding: 32px 20px 72px; }
}
@media (max-width: 640px) {
  .ch-meta-row { font-size: .76rem; gap: 6px 12px; }
  .va-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 12px; }
  .va-avatar-wrap { width: 64px; }
}
`;
