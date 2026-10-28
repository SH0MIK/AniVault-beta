const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const ALLOWED = ['fembed.co', 'vdohide.com', 'vdohls.com', 'vdohls.net', 'vdohls.org', 'vdohls.info', 'static.vdohls.com', 'avxtube-4.xyz'];

export function safeVdoUrl(value: string, base?: string): URL {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || !ALLOWED.some(d => url.hostname.toLowerCase() === d || url.hostname.toLowerCase().endsWith('.' + d))) {
    throw new Error('Blocked external host: ' + url.hostname);
  }
  return url;
}

async function fetchVdoText(url: string, referer: string): Promise<{text:string;url:string;contentType:string}> {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*', referer },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Upstream returned HTTP ' + response.status);
  return { text: await response.text(), url: response.url, contentType: response.headers.get('content-type') || '' };
}

function extractPlayerConfig(html: string): any {
  const marker = html.match(/(?:window\.)?PLAYER_CONFIG\s*=\s*/);
  if (!marker) throw new Error('PLAYER_CONFIG was not found in the embed HTML');
  const start = html.indexOf('{', marker.index! + marker[0].length);
  if (start < 0) throw new Error('PLAYER_CONFIG object was malformed');
  let depth = 0, quote = '', escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); }
      catch { throw new Error('PLAYER_CONFIG is JavaScript, not strict JSON'); }
    }
  }
  throw new Error('PLAYER_CONFIG object was incomplete');
}

function parseMasterPlaylist(text: string, base: string) {
  const qualities: any[] = [], audioTracks: any[] = [];
  const lines = text.split(/\r?\n/).map(x => x.trim());
  let pending: any = null;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/i.test(line)) {
      const attrs = Object.fromEntries([...line.matchAll(/([\w-]+)=("(?:[^"]*)"|[^,]*)/g)].map(m => [m[1], m[2].replace(/^"|"$ /g, '').replace(/^"|"$/g, '')]));
      audioTracks.push({ name: attrs.NAME || attrs.LANGUAGE || 'Audio', lang: attrs.LANGUAGE || attrs.NAME || 'und', default: attrs.DEFAULT === 'YES', ...(attrs.URI ? { url: safeVdoUrl(attrs.URI, base).href } : {}) });
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = Object.fromEntries([...line.matchAll(/([\w-]+)=("(?:[^"]*)"|[^,]*)/g)].map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
      pending = { label: attrs.RESOLUTION || (attrs.BANDWIDTH ? Math.round(Number(attrs.BANDWIDTH) / 1000) + ' kbps' : 'Auto'), ...(attrs.RESOLUTION ? { width: Number(attrs.RESOLUTION.split('x')[0]), height: Number(attrs.RESOLUTION.split('x')[1]) } : {}), ...(attrs.BANDWIDTH ? { bandwidth: Number(attrs.BANDWIDTH) } : {}) };
    } else if (line && !line.startsWith('#') && pending) {
      qualities.push({ ...pending, url: safeVdoUrl(line, base).href });
      pending = null;
    }
  }
  return { qualities, audioTracks };
}

export async function resolveVdoHideEmbed(embedUrl: string): Promise<any> {
  const embed = safeVdoUrl(embedUrl);
  const { text: html, url: finalEmbedUrl } = await fetchVdoText(embed.href, embed.origin + '/');
  const config = extractPlayerConfig(html);
  const id = config.vdoId || config.id || config.videoId;
  if (!id || !/^[\w-]+$/.test(String(id))) throw new Error('No valid vdoId found in PLAYER_CONFIG');
  const playlistHost = config.playlist || config.playlistHost || 'vdohls.com';
  const host = typeof playlistHost === 'string' ? playlistHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : 'vdohls.com';
  if (!ALLOWED.some(d => host === d || host.endsWith('.' + d))) throw new Error('Unrecognized playlist host: ' + host);
  const masterUrl = safeVdoUrl('https://' + host + '/' + id + '/playlist.m3u8').href;
  const subtitles = (Array.isArray(config.tracks) ? config.tracks : []).filter((t:any) => t && (t.file || t.src || t.url)).map((t:any) => ({
    label: t.label || t.kind || t.language || 'Subtitle',
    lang: t.srclang || t.language || t.label || 'und',
    default: !!t.default,
    url: safeVdoUrl(t.file || t.src || t.url, finalEmbedUrl).href,
  }));
  let qualities: any[] = [], audioTracks: any[] = [], playlistText: string | null = null, playlistError: string | null = null;
  try {
    const result = await fetchVdoText(masterUrl, finalEmbedUrl);
    playlistText = result.text;
    ({ qualities, audioTracks } = parseMasterPlaylist(playlistText, result.url));
  } catch (error) {
    playlistError = error instanceof Error ? error.message : String(error);
  }
  return { ok: true, provider: 'VdoHide', title: config.title || config.name || null, poster: config.poster || config.image || null, embedUrl: finalEmbedUrl, vdoId: String(id), masterUrl, playlistType: playlistText && playlistText.includes('#EXT-X-STREAM-INF') ? 'master' : 'media-or-unavailable', qualities, audioTracks, subtitles, playlistPreview: playlistText ? playlistText.slice(0, 12000) : null, playlistError };
}

function proxyUrl(url: string, referer: string, siteUrl: string): string {
  return siteUrl + '/api/vdohide_proxy.php?url=' + encodeURIComponent(url) + '&referer=' + encodeURIComponent(referer);
}

export async function proxyVdoHideRequest(urlValue: string, refererValue: string, siteUrl: string): Promise<Response> {
  const target = safeVdoUrl(urlValue);
  const referer = safeVdoUrl(refererValue || 'https://fembed.co/').href;
  const upstream = await fetch(target.href, { headers: { 'user-agent': UA, accept: '*/*', referer }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!upstream.ok) return new Response('Upstream HTTP ' + upstream.status, { status: upstream.status, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
  const type = upstream.headers.get('content-type') || '';
  const isPlaylist = /mpegurl|\.m3u8/i.test(type + ' ' + new URL(upstream.url).pathname);
  const headers = new Headers({ 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': type || (isPlaylist ? 'application/vnd.apple.mpegurl' : 'application/octet-stream') });
  if (!isPlaylist) return new Response(upstream.body, { status: upstream.status, headers });
  const body = await upstream.text();
  const base = new URL(upstream.url);
  const rewritten = body.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_match, uri) => 'URI="' + proxyUrl(safeVdoUrl(uri, base.href).href, referer, siteUrl) + '"');
    return proxyUrl(safeVdoUrl(trimmed, base.href).href, referer, siteUrl);
  }).join('\n');
  return new Response(rewritten, { status: 200, headers });
}
