import { Hono } from 'hono';
import type { Env } from '../../index';
import { buildAdminCtx } from '../../lib/admin-ctx';
import { searchHoshikaAnime, getHoshikaAnimeById } from '../../lib/hoshika-api';
import { renderAdminHeader, renderAdminFooter } from '../../render/admin-layout';
import { h } from '../../lib/helpers';
import { resolveVdoHideEmbed, proxyVdoHideRequest } from '../../lib/vdohide-resolver';

export const vdohideCacheRoutes = new Hono<{ Bindings: Env }>();

async function resolveEmbed(env: Env, embedUrl: string): Promise<any> {
  const base = (env.VDOHIDE_RESOLVER_BASE || '').replace(/\/+$/, '');
  if (!base) throw new Error('VDOHIDE_RESOLVER_BASE is not configured.');
  const endpoint = base + '/api/resolve?url=' + encodeURIComponent(embedUrl);
  const response = await fetch(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.ok || !data?.masterUrl) throw new Error(data?.error || 'Resolver failed to return a playable HLS master URL.');
  return data;
}

vdohideCacheRoutes.get('/api/vdohide_stream.php', async (c) => {
  const hoshikaId = (c.req.query('hoshikaId') || '').trim();
  const episode = Number(c.req.query('ep') || 0);
  if (!/^\\d+$/.test(hoshikaId) || !Number.isInteger(episode) || episode < 1) return c.json({ error: 'Missing Hoshika ID or valid episode.' }, 400);
  const row = await c.env.DB.prepare('SELECT embed_url, resolved_json FROM vdohide_stream_cache WHERE hoshika_short_id=? AND episode_num=?').bind(hoshikaId, episode).first<any>();
  if (!row) return c.json({ error: 'No VdoHide source saved for this series/episode.' }, 404);
  if (c.req.query('refresh') !== '1') {
    try {
      const cached = JSON.parse(row.resolved_json || '{}');
      if (cached?.ok && cached?.masterUrl) return c.json({ success: true, cached: true, data: cached });
    } catch {}
  }
  try {
    const data = await resolveVdoHideEmbed(String(row.embed_url));
    await c.env.DB.prepare("UPDATE vdohide_stream_cache SET resolved_json=?, updated_at=datetime('now') WHERE hoshika_short_id=? AND episode_num=?").bind(JSON.stringify(data), hoshikaId, episode).run();
    return c.json({ success: true, cached: false, refreshed: true, data });
  } catch (e) {
    // Keep the original embed permanently. A future playback attempt can resolve it again.
    return c.json({ error: e instanceof Error ? e.message : String(e), embedPreserved: true }, 502);
  }
});

vdohideCacheRoutes.get('/api/vdohide_proxy.php', async (c) => {
  try {
    const url = c.req.query('url') || '';
    const referer = c.req.query('referer') || 'https://fembed.co/';
    return await proxyVdoHideRequest(url, referer, c.env.SITE_URL);
  } catch (e) {
    return c.text('VdoHide proxy error: ' + (e instanceof Error ? e.message : String(e)), 502);
  }
});

vdohideCacheRoutes.get('/admin/vdohide.php', async (c) => {
  const ctx = await buildAdminCtx(c);
  const siteUrl = c.env.SITE_URL;
  if (!ctx) return c.redirect(siteUrl + '/');
  const rows = await ctx.db.fetchAll<any>('SELECT id, hoshika_short_id, episode_num, embed_url, updated_at, resolved_json FROM vdohide_stream_cache ORDER BY updated_at DESC');
  const entries = await Promise.all(rows.map(async (r:any) => {
    let title = 'Hoshika #' + r.hoshika_short_id, poster = '', count = 0, audios = 0, subtitles = 0;
    try {
      const a = await getHoshikaAnimeById(String(r.hoshika_short_id), c.env.HOSHIKA_API_KEY);
      if (a?.title) title = a.title;
      poster = a?.poster || '';
    } catch {}
    try { const d = JSON.parse(r.resolved_json); count = Array.isArray(d.qualities) ? d.qualities.length : 0; audios = Array.isArray(d.audioTracks) ? d.audioTracks.length : 0; subtitles = Array.isArray(d.subtitles) ? d.subtitles.length : 0; } catch {}
    return {...r,title,poster,count,audios,subtitles};
  }));
  const list = entries.map((r:any) => `<article class="entry"><div class="poster">${r.poster ? `<img src="${h(r.poster)}" alt="">` : '▶'}</div><div class="entry-body"><div class="muted">Hoshika #${h(r.hoshika_short_id)} · Episode ${r.episode_num}</div><h3>${h(r.title)}</h3><div class="meta">${r.count} qualities · ${r.audios} audio tracks · ${r.subtitles} subtitles</div><div class="muted small">Updated ${h(r.updated_at || '—')}</div><a target="_blank" rel="noopener" href="${h(r.embed_url)}">Open embed ↗</a><div class="actions"><button type="button" data-refresh="${r.hoshika_short_id}" data-ep="${r.episode_num}">Resolve fresh</button><button type="button" class="danger" data-delete="${r.id}">Delete</button></div><pre hidden id="result-${r.hoshika_short_id}-${r.episode_num}"></pre></div></article>`).join('');
  let html = renderAdminHeader({siteUrl,pageTitle:'VdoHide Resolver Cache',adminPage:'vdohide',isOwner:ctx.isOwner,impersonating:ctx.impersonating});
  html += `<style>.vh{max-width:1100px;margin:auto}.panel{padding:1rem;border:1px solid var(--border);border-radius:15px;margin:1rem 0;background:var(--surface,rgba(255,255,255,.025))}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.fields label{display:grid;gap:.35rem;color:var(--text-muted);font-size:.8rem}.fields input{width:100%;min-width:0;padding:.7rem;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--text-primary)}.fields .wide{grid-column:1/-1}.btn{padding:.65rem .9rem;border:0;border-radius:9px;background:#7c3aed;color:white;font-weight:800;cursor:pointer}.muted,.meta{color:var(--text-muted);font-size:.8rem}.small{font-size:.72rem}.entry{display:flex;gap:1rem;padding:1rem 0;border-bottom:1px solid var(--border)}.poster{width:75px;min-width:75px;height:100px;background:#151515;border-radius:8px;display:grid;place-items:center;overflow:hidden}.poster img{width:100%;height:100%;object-fit:cover}.entry-body{min-width:0;flex:1}.entry h3{margin:.2rem 0}.actions{display:flex;gap:.5rem;margin-top:.7rem}.danger{background:#7f1d1d;color:white;border:0;border-radius:9px;padding:.6rem;cursor:pointer}#search-results button{display:block;width:100%;text-align:left;margin:.35rem 0;padding:.65rem;border:1px solid var(--border);background:transparent;color:var(--text-primary);border-radius:8px;cursor:pointer}.status{white-space:pre-wrap;margin-top:.6rem}.status.error{color:#f87171}@media(max-width:620px){.fields{grid-template-columns:1fr}.fields .wide{grid-column:auto}.entry{gap:.65rem}.poster{width:55px;min-width:55px;height:80px}}</style><main class="vh"><h1>VdoHide Resolver Cache</h1><p class="muted">Save one embed per Hoshika series/episode. Resolution data lives in D1 indefinitely; playback can request a fresh resolution when a saved stream stops working.</p><section class="panel"><h2>Add series / episode</h2><div class="fields"><label class="wide">Search Hoshika series<input id="vh-query" placeholder="Search anime title"></label><div class="wide"><button class="btn" id="vh-search" type="button">Search Hoshika</button><div id="search-results"></div></div><label>Selected Hoshika ID<input id="vh-id" placeholder="Choose a search result"></label><label>Episode number<input id="vh-ep" type="number" min="1" step="1" value="1"></label><label class="wide">VdoHide / Fembed embed URL<input id="vh-url" placeholder="https://fembed.co/embed/..." spellcheck="false"></label></div><p><button class="btn" id="vh-save" type="button">Resolve & Save to D1</button></p><div class="status" id="vh-status"></div></section><section class="panel"><h2>Saved episodes (${entries.length})</h2>${list || '<p class="muted">Nothing saved yet.</p>'}</section></main><script>
const $=id=>document.getElementById(id);const status=(m,err=false)=>{ $('vh-status').textContent=m;$('vh-status').className='status'+(err?' error':'') };
$('vh-search').onclick=async()=>{const q=$('vh-query').value.trim();if(!q)return status('Enter a series title.',true);$('search-results').textContent='Searching…';try{const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'search',query:q})});const d=await r.json();if(!r.ok)throw Error(d.error||'Search failed');$('search-results').innerHTML='';d.results.forEach(a=>{const b=document.createElement('button');b.textContent=(a.title||a.titleEnglish||a.titleRomaji)+' · Hoshika #'+a.shortId;b.onclick=()=>{$('vh-id').value=a.shortId;$('vh-query').value=a.title||a.titleEnglish||a.titleRomaji;$('search-results').textContent='Selected: '+$('vh-query').value+' (#'+a.shortId+')'};$('search-results').appendChild(b)});if(!d.results.length)$('search-results').textContent='No results found.'}catch(e){$('search-results').textContent=e.message}};
$('vh-save').onclick=async()=>{const body={action:'save',hoshikaId:$('vh-id').value.trim(),episode:Number($('vh-ep').value),embedUrl:$('vh-url').value.trim()};if(!body.hoshikaId||!Number.isInteger(body.episode)||body.episode<1||!body.embedUrl)return status('Choose a series, episode, and embed URL.',true);$('vh-save').disabled=true;status('Resolving stream and saving to D1…');try{const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Save failed');status(d.resolved===false?'Embed saved. Initial resolve failed, but playback will retry from the saved embed: '+(d.error||d.message||'unknown resolver error'):'Saved. '+(d.qualities||0)+' qualities, '+(d.audioTracks||0)+' audio tracks, '+(d.subtitles||0)+' subtitles.');setTimeout(()=>location.reload(),1200)}catch(e){status(e.message,true)}finally{$('vh-save').disabled=false}};
document.querySelectorAll('[data-refresh]').forEach(b=>b.onclick=async()=>{b.disabled=true;const key=b.dataset.refresh+'-'+b.dataset.ep;const box=$('result-'+key);box.hidden=false;box.textContent='Resolving fresh stream…';try{const r=await fetch('/api/vdohide_stream.php?hoshikaId='+encodeURIComponent(b.dataset.refresh)+'&ep='+b.dataset.ep+'&refresh=1');const d=await r.json();if(!r.ok)throw Error(d.error||'Refresh failed');box.textContent=JSON.stringify(d.data,null,2)}catch(e){box.textContent=e.message}finally{b.disabled=false}});
document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this saved episode?'))return;b.disabled=true;try{const r=await fetch(location.pathname,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({id:Number(b.dataset.delete)})});const d=await r.json();if(!r.ok)throw Error(d.error||'Delete failed');location.reload()}catch(e){alert(e.message);b.disabled=false}});
</script>`;
  html += renderAdminFooter(siteUrl);
  await ctx.session.save(c, ctx.lifetime);
  return c.html(html);
});

vdohideCacheRoutes.post('/admin/vdohide.php', async (c) => {
  const ctx = await buildAdminCtx(c);
  if (!ctx) return c.json({ error: 'Forbidden' }, 403);
  const body:any = await c.req.json().catch(() => null);
  if (body?.action === 'search') {
    const query = String(body.query || '').trim();
    if (!query) return c.json({ error: 'Enter a title to search.' }, 400);
    const results = await searchHoshikaAnime(query, 12, c.env.HOSHIKA_API_KEY);
    return c.json({ success:true, results:results.map(a=>({shortId:a.shortId,title:a.title,titleEnglish:a.titleEnglish,titleRomaji:a.titleRomaji,poster:a.poster})) });
  }
  if (body?.action !== 'save') return c.json({error:'Unknown action'},400);
  const hoshikaId = String(body.hoshikaId || '').trim(), episode = Number(body.episode), embedUrl = String(body.embedUrl || '').trim();
  if (!/^\d+$/.test(hoshikaId) || !Number.isInteger(episode) || episode < 1 || episode > 9999) return c.json({error:'Choose a valid Hoshika ID and episode number.'},400);
  let parsed:URL;
  try { parsed = new URL(embedUrl); } catch { return c.json({error:'Enter a valid embed URL.'},400); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !['fembed.co','vdohide.com','vdohls.com'].some(root=>host===root||host.endsWith('.'+root))) return c.json({error:'Use an HTTPS Fembed/VdoHide embed URL.'},400);
  // Persist the embed FIRST. If upstream resolution fails now, the source is still
  // saved and can be resolved again on the next playback attempt.
  await ctx.db.query("INSERT INTO vdohide_stream_cache (hoshika_short_id,episode_num,embed_url,resolved_json,updated_at) VALUES (?,?,?,'{}',datetime('now')) ON CONFLICT(hoshika_short_id,episode_num) DO UPDATE SET embed_url=excluded.embed_url,updated_at=datetime('now')",[hoshikaId,episode,embedUrl]);
  try {
    const data = await resolveVdoHideEmbed(embedUrl);
    await ctx.db.query("UPDATE vdohide_stream_cache SET resolved_json=?,updated_at=datetime('now') WHERE hoshika_short_id=? AND episode_num=?",[JSON.stringify(data),hoshikaId,episode]);
    return c.json({success:true,qualities:data.qualities?.length||0,audioTracks:data.audioTracks?.length||0,subtitles:data.subtitles?.length||0});
  } catch(e) {
    return c.json({success:true,embedSaved:true,resolved:false,message:'Embed saved; resolving can be retried during playback.',error:e instanceof Error?e.message:String(e)});
  }
});

vdohideCacheRoutes.delete('/admin/vdohide.php', async (c) => {
  const ctx = await buildAdminCtx(c);
  if (!ctx) return c.json({error:'Forbidden'},403);
  const body:any = await c.req.json().catch(()=>null);
  const id = Number(body?.id || 0);
  if (!Number.isInteger(id) || id < 1) return c.json({error:'Missing entry ID'},400);
  await ctx.db.query('DELETE FROM vdohide_stream_cache WHERE id=?',[id]);
  return c.json({success:true});
});
