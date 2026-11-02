export const PROFILE_CSS = `
.banner-adjust-modal{width:min(760px,calc(100vw - 1rem));max-width:calc(100vw - 1rem)}
.banner-adjust-stage{position:relative;width:100%;height:clamp(130px,28vw,230px);border-radius:12px;background-color:#090b14;background-repeat:no-repeat;overflow:hidden;cursor:grab;touch-action:none;user-select:none;border:1px solid var(--border);background-position:50% 50%;background-size:cover}
.banner-adjust-stage:active{cursor:grabbing}
.banner-adjust-hint{position:absolute;left:10px;bottom:10px;padding:5px 9px;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font-size:.72rem;pointer-events:none}
.banner-adjust-zoom{margin:16px 0}
.banner-adjust-zoom label{display:flex;justify-content:space-between;gap:12px}
.banner-adjust-zoom input{width:100%;accent-color:var(--accent)}
.banner-adjust-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.banner-adjust-actions .text-muted{margin-right:auto;font-size:.8rem}
.u-banner-adjust-btn{position:absolute;right:120px;top:12px;z-index:5;display:inline-flex;align-items:center;gap:6px;padding:8px 11px;border:1px solid rgba(255,255,255,.2);border-radius:9px;background:rgba(8,10,18,.78);color:#fff;backdrop-filter:blur(10px);cursor:pointer}
@media(max-width:600px){.u-banner-adjust-btn{right:12px;top:54px}.banner-adjust-actions{align-items:stretch}.banner-adjust-actions>*{flex:1}.banner-adjust-actions .text-muted{flex-basis:100%;order:-1}}
.avatar-cropper-modal {
  max-width: calc(100vw - 1rem);
  width: min(calc(100vw - 1rem), 720px);
  max-height: calc(100vh - 1rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.avatar-cropper-modal .modal-header {
  flex: 0 0 auto;
  padding: 14px;
}
.avatar-cropper-modal .modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 14px 14px;
  scrollbar-color: var(--accent) rgba(255,255,255,0.08);
  scrollbar-width: thin;
}
.avatar-cropper-modal .modal-body::-webkit-scrollbar { width: 10px; }
.avatar-cropper-modal .modal-body::-webkit-scrollbar-track { background: rgba(255,255,255,0.08); border-radius: 999px; }
.avatar-cropper-modal .modal-body::-webkit-scrollbar-thumb { background: var(--accent); border-radius: 999px; }
.avatar-crop-stage {
  position: relative;
  width: 100%;
  max-width: 100%;
  margin: 0 auto 12px;
  background: #020611;
  border-radius: var(--radius-md);
  overflow: hidden;
  touch-action: none;
}
.avatar-crop-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 14px;
  margin-bottom: 12px;
}
.avatar-crop-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: end;
}
.avatar-crop-footer > p { flex: 1 1 180px; margin: 0; }
.avatar-crop-previews,
.avatar-crop-actions { display: flex; align-items: center; gap: 10px; }
.avatar-crop-actions { flex: 0 0 auto; justify-content: flex-end; margin-left: auto; }
.crop-handle {
  position: absolute;
  width: 12px; height: 12px;
  background: #fff;
  border: 2px solid rgba(0,0,0,0.5);
  border-radius: 2px;
}
@media (max-width: 620px) {
  .avatar-crop-controls,
  .avatar-crop-footer { display: flex; flex-direction: column; align-items: stretch; }
  .avatar-crop-actions { justify-content: stretch; margin-left: 0; }
  .avatar-crop-actions .btn { flex: 1; }
}

/* Privacy tab toggle switches */
.toggle-row { cursor: pointer; }
.toggle-switch { appearance: none; -webkit-appearance: none; width: 42px; height: 24px; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid var(--border); position: relative; flex-shrink: 0; cursor: pointer; transition: background .15s ease; }
.toggle-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s ease; }
.toggle-switch:checked { background: var(--accent); border-color: var(--accent); }
.toggle-switch:checked::after { transform: translateX(18px); }

.danger-zone { border-color: rgba(124,58,237,.35); }

/* Social links inputs — icon-prefixed rows in the Account tab */
.social-input-row { display: flex; align-items: center; gap: 10px; }
.social-input-row svg.icon { flex-shrink: 0; width: 18px; height: 18px; color: var(--text-muted); }
.social-input-row .form-control { flex: 1; }
.social-input-spacer { display: inline-block; width: 18px; flex-shrink: 0; }
.social-input-static { flex: 1; font-size: .85rem; color: var(--text-secondary); background: rgba(255,255,255,.03); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 9px 12px; display: flex; align-items: center; gap: 6px; }
.social-input-static svg.icon { color: var(--accent); }

.av-settings-banner-row{align-items:flex-start;gap:18px}
.av-settings-banner-row .settings-row-label{flex:1;min-width:0}
.av-settings-banner-preview{width:min(100%,420px);height:104px;margin-top:12px;border:1px solid var(--border);border-radius:9px;background-color:rgba(255,255,255,.035);background-position:center;background-size:cover}
.av-settings-banner-preview.is-empty{display:flex;align-items:center;justify-content:center}
.av-settings-banner-preview.is-empty:after{content:'No banner uploaded';color:var(--text-muted);font-size:.76rem}
.av-settings-banner-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
@media(max-width:540px){.av-settings-banner-row{flex-direction:column;align-items:stretch}.av-settings-banner-actions{justify-content:flex-start}}
/* Settings page refresh */
.av-settings-page{max-width:1180px;padding-top:34px;padding-bottom:64px}
.av-settings-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:0 0 24px}
.av-settings-eyebrow{display:flex;align-items:center;gap:8px;color:var(--accent);font-size:.7rem;font-weight:800;letter-spacing:.14em;margin-bottom:9px}
.av-settings-heading h1{font-size:clamp(1.8rem,3vw,2.35rem);line-height:1.1;margin:0;color:var(--text-primary);letter-spacing:-.035em}
.av-settings-heading p{color:var(--text-muted);margin:9px 0 0;font-size:.92rem}
.av-settings-public-link{display:inline-flex;align-items:center;gap:8px;color:var(--text-secondary);font-size:.82rem;text-decoration:none;padding:10px 13px;border:1px solid var(--border);border-radius:10px;white-space:nowrap}
.av-settings-public-link:hover{border-color:var(--accent);color:var(--text-primary)}
.av-settings-identity{display:flex;align-items:center;gap:16px;padding:17px 19px;margin-bottom:22px;background:var(--card-bg,rgba(255,255,255,.025));border:1px solid var(--border);border-radius:14px}
.av-settings-avatar{position:relative;flex:0 0 58px;width:58px;height:58px;cursor:pointer}
.av-settings-avatar .u-avatar{width:58px;height:58px;font-size:1.35rem}
.av-settings-avatar-edit{position:absolute;right:-3px;bottom:-3px;width:23px;height:23px;display:grid;place-items:center;background:var(--accent);color:#fff;border:2px solid var(--bg);border-radius:50%}
.av-settings-identity-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.av-settings-identity-copy strong{display:flex;align-items:center;gap:7px;color:var(--text-primary);font-size:1rem}
.av-settings-identity-copy>span{color:var(--text-secondary);font-size:.82rem;overflow-wrap:anywhere}
.av-settings-identity-copy small{color:var(--text-muted);font-size:.72rem}
.av-settings-status{font-size:.72rem;color:var(--text-muted)}
.av-settings-identity-actions{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}
.av-settings-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:22px;align-items:start}
.av-settings-nav{position:sticky;top:20px;display:flex;flex-direction:column;gap:5px;padding:10px;background:var(--card-bg,rgba(255,255,255,.025));border:1px solid var(--border);border-radius:14px}
.av-settings-nav-label{padding:9px 10px 6px;color:var(--text-muted);font-size:.65rem;font-weight:800;letter-spacing:.13em}
.av-settings-nav .profile-tab-btn,.av-settings-nav-link{width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;border:0;border-radius:9px;background:transparent;color:var(--text-secondary);font:inherit;font-size:.84rem;text-align:left;text-decoration:none;cursor:pointer;transition:background .16s,color .16s}
.av-settings-nav .profile-tab-btn:hover,.av-settings-nav-link:hover{background:rgba(255,255,255,.045);color:var(--text-primary)}
.av-settings-nav .profile-tab-btn.active{background:rgba(232,69,60,.12);color:var(--text-primary);font-weight:700}
.av-settings-nav .profile-tab-btn.active svg{color:var(--accent)}
.av-settings-nav-link svg:last-child{margin-left:auto;color:var(--text-muted)}
.av-settings-nav-divider{height:1px;background:var(--border);margin:7px 5px}
.av-settings-content{min-width:0}
.av-settings-content .profile-tab-panel{min-width:0}
.av-settings-content .settings-card{overflow:hidden;border:1px solid var(--border);border-radius:13px;background:var(--card-bg,rgba(255,255,255,.025))}
.av-settings-content .settings-row{padding:17px 19px;border-bottom:1px solid var(--border)}
.av-settings-content .settings-row:last-child{border-bottom:0}
.av-settings-content .settings-row-name{font-size:.9rem}
.av-settings-content .settings-row-desc{font-size:.78rem;line-height:1.55;color:var(--text-muted)}
.av-settings-content .danger-zone{border-color:rgba(232,69,60,.38)}
.av-settings-content .danger-zone .settings-row-name{color:var(--accent)}
.av-settings-content .form-control{border-radius:9px}
@media(max-width:760px){.av-settings-page{padding-top:22px}.av-settings-layout{grid-template-columns:1fr;gap:14px}.av-settings-nav{position:static;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.av-settings-nav-label,.av-settings-nav-divider,.av-settings-nav-link{display:none}.av-settings-nav .profile-tab-btn{justify-content:center;flex-direction:column;gap:5px;padding:10px 5px;font-size:.72rem;text-align:center}}
@media(max-width:540px){.av-settings-heading{align-items:flex-start;flex-direction:column;gap:13px}.av-settings-identity{align-items:flex-start;flex-wrap:wrap;padding:14px}.av-settings-identity-copy{flex:1;min-width:calc(100% - 80px)}.av-settings-identity-actions{width:100%;margin:4px 0 0;justify-content:flex-start}.av-settings-identity-actions .btn{flex:1}.av-settings-nav{grid-template-columns:repeat(3,minmax(0,1fr))}.av-settings-content .settings-row{padding:14px}}

</style>
`;
