import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 3000);
const STORE = 'https://coverprint.fr';
const TTL = 1000 * 60 * 60 * 3;
let snapshot = { updatedAt: 0, products: [], error: null };
let pending = null;
const headers = {'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'};

async function fetchPage(page) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${STORE}/products.json?limit=250&page=${page}`, { signal: controller.signal, headers: { 'Accept': 'application/json', 'User-Agent': 'Coverprint-Product-Assistant/1.0' } });
    if (!res.ok) throw new Error(`Catalogue HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.products)) throw new Error('Format de catalogue inattendu');
    return json.products;
  } finally { clearTimeout(timeout); }
}
async function syncCatalog() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const result = [];
      for (let page = 1; page <= 100; page++) {
        const batch = await fetchPage(page);
        if (!batch.length) break;
        for (const p of batch) {
          if (!p.handle || !p.title) continue;
          result.push({ id:p.id, title:p.title, handle:p.handle, description: String(p.body_html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').slice(0,5000), type:p.product_type || '', tags: Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags || ''), image:p.images?.[0]?.src || null, available:p.variants?.some(v=>v.available) ?? null, url:`${STORE}/products/${encodeURIComponent(p.handle)}` });
        }
        if (page === 100) throw new Error('Catalogue trop volumineux : limite de synchronisation atteinte');
      }
      if (!result.length) throw new Error('Aucun produit public renvoyé');
      snapshot = { updatedAt:Date.now(), products:result, error:null };
    } catch(err) {
      snapshot.error = err.message;
      // Preserve prior good snapshot if refresh fails.
    } finally { pending = null; }
    return snapshot;
  })();
  return pending;
}

const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server = http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET') { res.writeHead(405, headers); return res.end(); }
    if (url.pathname === '/api/catalog') {
      if (!snapshot.updatedAt || Date.now()-snapshot.updatedAt>TTL) await syncCatalog();
      res.writeHead(200, {...headers, 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'public, max-age=180'});
      return res.end(JSON.stringify({products:snapshot.products, count:snapshot.products.length, updatedAt:snapshot.updatedAt, source:snapshot.products.length?'live':'demo', error:snapshot.error}));
    }
    const target = url.pathname === '/' ? '/index.html' : url.pathname;
    const resolved = path.resolve(ROOT, '.'+decodeURIComponent(target));
    if (!resolved.startsWith(ROOT+path.sep)) { res.writeHead(403,headers); return res.end(); }
    const data = await fs.readFile(resolved);
    res.writeHead(200, {...headers, 'Content-Type':mime[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': target==='/index.html'?'no-cache':'public, max-age=3600'});
    res.end(data);
  } catch { res.writeHead(404, headers); res.end('Introuvable'); }
});
server.listen(PORT, '0.0.0.0', ()=>console.log(`Coverprint Assistant : http://localhost:${PORT}`));
