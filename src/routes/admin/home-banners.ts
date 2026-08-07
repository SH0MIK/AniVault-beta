// Admin panel for the homepage hero carousel. Separate from anime-banners.ts
// (which only overrides the wide banner shown on a single anime's own page).
// This table drives which titles appear in the hero slider on the homepage
// itself, in an admin-chosen order, instead of the auto-generated
// seasonal/top-anime pool — see home.ts's getCuratedHeroBanners() usage.
//
// Table expected (create once via wrangler d1 execute):
//   CREATE TABLE home_hero_banners (
//     id INTEGER PRIMARY KEY AUTOINCREMENT,
//     anime_id INTEGER NOT NULL,
//     anime_title TEXT,
//     banner_image_url TEXT,
//     logo_image_url TEXT,
//     display_order INTEGER NOT NULL DEFAULT 0,
//     source TEXT NOT NULL DEFAULT 'url',
//     created_at TEXT NOT NULL DEFAULT (datetime('now')),
//     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
//   );
//   CREATE INDEX idx_home_hero_banners_order ON home_hero_banners(display_order);
import { Hono } from 'hono';
import type { Env } from '../../index';
import { buildAdminCtx } from '../../lib/admin-ctx';
import { h } from '../../lib/helpers';
import { renderAdminHeader, renderAdminFooter } from '../../render/admin-layout';

export const adminHomeBannersRoutes = new Hono<{ Bindings: Env }>();

const R2_PREFIX = 'home-banner-library/';
const ALLOWED_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 3 * 1024 * 1024;

function isValidUrl(u: string): boolean {
  try { const parsed = new URL(u); return parsed.protocol === 'http:' || parsed.protocol === 'https:'; } catch { return false; }
}

async function nextDisplayOrder(db: any): Promise<number> {
  const row = await db.fetchOne<{ mx: number | null }>('SELECT MAX(display_order) as mx FROM home_hero_banners');
  return (row?.mx ?? 0) + 1;
}

async function uploadToLibrary(env: Env, file: File, prefix: string): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('Image is too large. Use 3 MB or less.');
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) throw new Error('Upload JPG, PNG, or WebP only.');
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = await file.arrayBuffer();
  await env.AVATARS.put(`${R2_PREFIX}${filename}`, buf, { httpMetadata: { contentType: file.type } });
  return `${env.SITE_URL}/assets/img/home-banner-library/${filename}`;
}

async function deleteFromLibraryIfLocal(env: Env, url: string | null | undefined): Promise<void> {
  if (!url || !url.includes('/assets/img/home-banner-library/')) return;
  const filename = url.split('/assets/img/home-banner-library/')[1];
  try { await env.AVATARS.delete(`${R2_PREFIX}${filename}`); } catch { /* best-effort */ }
}

adminHomeBannersRoutes.on(['GET', 'POST'], '/admin/home_banners.php', async (c) => {
  const ctx = await buildAdminCtx(c);
  const siteUrl = c.env.SITE_URL;
  if (!ctx) return c.redirect(siteUrl + '/');
  const { db, session, lifetime, isOwner, impersonating } = ctx;

  if (c.req.method === 'POST') {
    const formData = await c.req.formData();
    const action = (formData.get('action') as string) ?? '';

    try {
      if (action === 'add_banner') {
        // Adds one new slide to the end of the carousel order — the "search
        // and add one by one" flow: enter/confirm the anime, drop in a
        // banner, it lands at the bottom of the ordered list.
        const animeId = parseInt((formData.get('anime_id') as string) ?? '0', 10) || 0;
        const title = ((formData.get('anime_title') as string) ?? '').trim();
        if (!animeId) throw new Error('Enter a valid Anime ID.');

        const file = formData.get('image_file') as File | null;
        const urlInput = ((formData.get('image_url') as string) ?? '').trim();
        let imageUrl = '';
        let source = 'url';
        if (file && file.size > 0) {
          imageUrl = await uploadToLibrary(c.env, file, `anime-${animeId}`);
          source = 'upload';
        } else if (urlInput) {
          if (!isValidUrl(urlInput)) throw new Error('Enter a valid image URL.');
          imageUrl = urlInput;
        } else {
          throw new Error('Choose a banner file or paste an image URL.');
        }

        const order = await nextDisplayOrder(db);
        await db.query(
          `INSERT INTO home_hero_banners (anime_id, anime_title, banner_image_url, display_order, source) VALUES (?,?,?,?,?)`,
          [animeId, title || null, imageUrl, order, source]
        );
        session.setFlash('success', 'Banner added to the hero carousel.');
      } else if (action === 'add_logo') {
        // Attaches/replaces the transparent title-logo overlay for an
        // existing slide — reuse an anime already in the carousel, or
        // create the slide on the fly if the Anime ID isn't there yet, so
        // this button works as a standalone "upload logo" shortcut too.
        const animeId = parseInt((formData.get('anime_id') as string) ?? '0', 10) || 0;
        const title = ((formData.get('anime_title') as string) ?? '').trim();
        if (!animeId) throw new Error('Enter a valid Anime ID.');

        const file = formData.get('image_file') as File | null;
        const urlInput = ((formData.get('image_url') as string) ?? '').trim();
        let logoUrl = '';
        if (file && file.size > 0) {
          logoUrl = await uploadToLibrary(c.env, file, `logo-${animeId}`);
        } else if (urlInput) {
          if (!isValidUrl(urlInput)) throw new Error('Enter a valid image URL.');
          logoUrl = urlInput;
        } else {
          throw new Error('Choose a logo file or paste an image URL.');
        }

        const existing = await db.fetchOne<any>('SELECT id FROM home_hero_banners WHERE anime_id=?', [animeId]);
        if (existing) {
          await db.query(`UPDATE home_hero_banners SET logo_image_url=?, updated_at=datetime('now') WHERE anime_id=?`, [logoUrl, animeId]);
        } else {
          const order = await nextDisplayOrder(db);
          await db.query(
            `INSERT INTO home_hero_banners (anime_id, anime_title, logo_image_url, display_order, source) VALUES (?,?,?,?,?)`,
            [animeId, title || null, logoUrl, order, file && file.size > 0 ? 'upload' : 'url']
          );
        }
        session.setFlash('success', 'Logo saved.');
      } else if (action === 'move_up' || action === 'move_down') {
        const id = parseInt((formData.get('id') as string) ?? '0', 10) || 0;
        const current = await db.fetchOne<any>('SELECT id, display_order FROM home_hero_banners WHERE id=?', [id]);
        if (current) {
          const neighbor = action === 'move_up'
            ? await db.fetchOne<any>('SELECT id, display_order FROM home_hero_banners WHERE display_order < ? ORDER BY display_order DESC LIMIT 1', [current.display_order])
            : await db.fetchOne<any>('SELECT id, display_order FROM home_hero_banners WHERE display_order > ? ORDER BY display_order ASC LIMIT 1', [current.display_order]);
          if (neighbor) {
            await db.query('UPDATE home_hero_banners SET display_order=? WHERE id=?', [neighbor.display_order, current.id]);
            await db.query('UPDATE home_hero_banners SET display_order=? WHERE id=?', [current.display_order, neighbor.id]);
          }
        }
      } else if (action === 'delete') {
        const id = parseInt((formData.get('id') as string) ?? '0', 10) || 0;
        if (!id) throw new Error('Missing banner id.');
        const row = await db.fetchOne<any>('SELECT banner_image_url, logo_image_url FROM home_hero_banners WHERE id=?', [id]);
        if (row) {
          await deleteFromLibraryIfLocal(c.env, row.banner_image_url);
          await deleteFromLibraryIfLocal(c.env, row.logo_image_url);
        }
        await db.query('DELETE FROM home_hero_banners WHERE id=?', [id]);
        session.setFlash('success', 'Removed from the hero carousel.');
      }
    } catch (e: any) {
      session.setFlash('error', e.message ?? 'An error occurred.');
    }
    await session.save(c, lifetime);
    return c.redirect(`${siteUrl}/admin/home_banners.php`);
  }

  const q = (c.req.query('q') ?? '').trim();
  let where = '';
  const params: unknown[] = [];
  if (q) {
    if (/^\d+$/.test(q)) { where = 'WHERE anime_id = ? OR anime_title LIKE ?'; params.push(parseInt(q, 10), `%${q}%`); }
    else { where = 'WHERE anime_title LIKE ?'; params.push(`%${q}%`); }
  }
  const slides = await db.fetchAll<any>(`SELECT * FROM home_hero_banners ${where} ORDER BY display_order ASC`, params);
  const total = await db.count('SELECT COUNT(*) as cnt FROM home_hero_banners');

  const flash = session.takeFlash();
  const err = flash?.type === 'error' ? flash.message : null;
  const suc = flash?.type === 'success' ? flash.message : null;

  let html = renderAdminHeader({ siteUrl, pageTitle: 'Homepage Hero Carousel', adminPage: 'home_banners', isOwner, impersonating });
  html += `
<style>
.image-admin-grid { display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom:1.5rem; }
.hero-slide-list { display:flex; flex-direction:column; gap:10px; }
.hero-slide-row { display:flex; align-items:center; gap:14px; background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:10px 14px; }
.hero-slide-order { font-family:var(--font-display); font-size:1.1rem; color:var(--text-muted); width:28px; text-align:center; flex-shrink:0; }
.hero-slide-order-btns { display:flex; flex-direction:column; gap:2px; flex-shrink:0; }
.hero-slide-order-btns button { background:none; border:1px solid var(--border); color:var(--text-muted); border-radius:4px; width:22px; height:20px; line-height:1; cursor:pointer; font-size:0.7rem; }
.hero-slide-order-btns button:hover { background:var(--bg-hover); color:var(--text-primary); }
.hero-slide-thumb { width:120px; aspect-ratio:2.5/1; object-fit:cover; border-radius:6px; background:var(--bg-base); flex-shrink:0; }
.hero-slide-logo { width:70px; height:44px; object-fit:contain; background:var(--bg-base); border-radius:6px; flex-shrink:0; padding:4px; }
.hero-slide-logo-empty { width:70px; height:44px; border:1px dashed var(--border); border-radius:6px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:0.7rem; text-align:center; }
.hero-slide-info { flex:1; min-width:0; }
.hero-slide-title { font-weight:700; color:var(--text-primary); font-size:0.92rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hero-slide-meta { color:var(--text-muted); font-size:0.78rem; margin-top:2px; }
.hero-slide-actions { display:flex; gap:8px; flex-shrink:0; }
@media (max-width: 900px) { .image-admin-grid { grid-template-columns:1fr; } .hero-slide-row { flex-wrap:wrap; } }
</style>

<div class="admin-header">
  <div><h1>Homepage Hero Carousel</h1><p class="text-muted" style="font-size:0.9rem;">Curated, ordered slides for the homepage hero — takes priority over the auto-generated seasonal/top-anime pool once you add at least one slide here.</p></div>
  <span class="badge badge-default">${total.toLocaleString('en-US')} slides</span>
</div>

${suc ? `<div class="alert alert-success mb-2">${h(suc)}</div>` : ''}
${err ? `<div class="alert alert-error mb-2">${h(err)}</div>` : ''}

<div class="image-admin-grid">
  <div class="card card-body">
    <h2 class="mb-2">➕ Add Banner Image</h2>
    <p class="text-muted" style="font-size:0.82rem;margin-top:-6px;margin-bottom:10px;">Adds a new slide to the end of the order below.</p>
    <form method="POST" enctype="multipart/form-data">
      <input type="hidden" name="action" value="add_banner">
      <div class="form-group"><label class="form-label">Anime ID (MAL ID)</label><input class="form-control" type="number" name="anime_id" required placeholder="16498"></div>
      <div class="form-group"><label class="form-label">Title</label><input class="form-control" name="anime_title" placeholder="Optional, for searching"></div>
      <div class="form-group"><label class="form-label">Banner File (wide, ~1900x758)</label><input class="form-control" type="file" name="image_file" accept="image/jpeg,image/png,image/webp"></div>
      <div class="form-group"><label class="form-label">…or Banner URL</label><input class="form-control" type="url" name="image_url" placeholder="https://..."></div>
      <button class="btn btn-primary" type="submit">Add Banner Image</button>
    </form>
  </div>
  <div class="card card-body">
    <h2 class="mb-2">🏷️ Add Logo</h2>
    <p class="text-muted" style="font-size:0.82rem;margin-top:-6px;margin-bottom:10px;">Attaches a transparent title-logo overlay to a slide (existing Anime ID) or starts a new one.</p>
    <form method="POST" enctype="multipart/form-data">
      <input type="hidden" name="action" value="add_logo">
      <div class="form-group"><label class="form-label">Anime ID (MAL ID)</label><input class="form-control" type="number" name="anime_id" required placeholder="16498"></div>
      <div class="form-group"><label class="form-label">Title</label><input class="form-control" name="anime_title" placeholder="Optional, for searching"></div>
      <div class="form-group"><label class="form-label">Logo File (transparent PNG/WebP)</label><input class="form-control" type="file" name="image_file" accept="image/jpeg,image/png,image/webp"></div>
      <div class="form-group"><label class="form-label">…or Logo URL</label><input class="form-control" type="url" name="image_url" placeholder="https://..."></div>
      <button class="btn btn-primary" type="submit">Add Logo</button>
    </form>
  </div>
</div>

<div class="card card-body mb-3">
  <form method="GET" style="display:flex;gap:8px;flex-wrap:wrap;">
    <input class="form-control" name="q" value="${h(q)}" placeholder="Search by title or Anime ID" style="max-width:320px;">
    <button class="btn btn-primary" type="submit">Search</button>
    ${q ? `<a class="btn btn-ghost" href="home_banners.php">Clear</a>` : ''}
  </form>
</div>

${slides.length === 0 ? `<div class="card card-body text-center text-muted">No hero slides yet — add one above. Until you do, the homepage hero falls back to the auto-generated seasonal list.</div>` : `
<div class="hero-slide-list">
  ${slides.map((s: any, i: number) => `
  <div class="hero-slide-row">
    <div class="hero-slide-order">${i + 1}</div>
    <div class="hero-slide-order-btns">
      <form method="POST"><input type="hidden" name="action" value="move_up"><input type="hidden" name="id" value="${s.id}"><button type="submit" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button></form>
      <form method="POST"><input type="hidden" name="action" value="move_down"><input type="hidden" name="id" value="${s.id}"><button type="submit" ${i === slides.length - 1 ? 'disabled' : ''} title="Move down">▼</button></form>
    </div>
    ${s.banner_image_url ? `<img class="hero-slide-thumb" src="${h(s.banner_image_url)}" alt="">` : `<div class="hero-slide-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;">No banner</div>`}
    ${s.logo_image_url ? `<img class="hero-slide-logo" src="${h(s.logo_image_url)}" alt="">` : `<div class="hero-slide-logo-empty">No logo</div>`}
    <div class="hero-slide-info">
      <div class="hero-slide-title">${h(s.anime_title || 'Untitled')}</div>
      <div class="hero-slide-meta">#${s.anime_id} · banner: ${h(s.source)}</div>
    </div>
    <div class="hero-slide-actions">
      <form method="POST" onsubmit="return confirm('Remove this slide from the hero carousel?')">
        <input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${s.id}">
        <button class="btn btn-danger btn-sm" type="submit">Delete</button>
      </form>
    </div>
  </div>`).join('')}
</div>`}`;

  html += renderAdminFooter(siteUrl);
  await session.save(c, lifetime);
  return c.html(html);
});

adminHomeBannersRoutes.get('/assets/img/home-banner-library/:filename', async (c) => {
  const filename = c.req.param('filename');
  const obj = await c.env.AVATARS.get(`${R2_PREFIX}${filename}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
});
