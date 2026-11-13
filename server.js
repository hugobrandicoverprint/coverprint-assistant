import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 3000);
const STORE = 'https://coverprint.fr';
const TTL = 1000 * 60 * 60 * 3;
const DB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const DB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
let dbSync = { updatedAt: 0, count: 0, error: null };

async function saveProductsToDatabase(products) {
  if (!DB_URL || !DB_KEY) return;
  // Supabase sb_secret_* keys are NOT JWTs: send them as apikey only.
  // Legacy service_role JWTs can still be used as Bearer tokens.
  const dbHeaders = { apikey: DB_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  if (!DB_KEY.startsWith('sb_secret_')) dbHeaders.Authorization = `Bearer ${DB_KEY}`;
  const normalized = products.filter(p=>p.handle).map(p=>({
    shopify_id:String(p.id),handle:p.handle,title:p.title,description:p.description,
    product_type:p.type,vendor:p.vendor || null,product_url:p.url,image_url:p.image,
    status:'active',synced_at:new Date().toISOString()
  }));
  // Upserts en petits lots ; Supabase est configuré pour refuser l'accès public.
  for (let i=0;i<normalized.length;i+=100) {
    const response = await fetch(`${DB_URL}/rest/v1/cp_products?on_conflict=handle`, {
      method:'POST',headers:dbHeaders,body:JSON.stringify(normalized.slice(i,i+100)),
      signal:AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${(await response.text()).slice(0,250)}`);
  }
  dbSync = {updatedAt:Date.now(),count:normalized.length,error:null};
  console.log(`Supabase: ${normalized.length} produits synchronisés`);
}
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
          result.push({ id:p.id, title:p.title, handle:p.handle, description: String(p.body_html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').slice(0,5000), type:p.product_type || '', tags: Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags || ''), image:p.images?.[0]?.src || null, vendor:p.vendor || '', available:p.variants?.some(v=>v.available) ?? null, url:`${STORE}/products/${encodeURIComponent(p.handle)}` });
        }
        if (page === 100) throw new Error('Catalogue trop volumineux : limite de synchronisation atteinte');
      }
      if (!result.length) throw new Error('Aucun produit public renvoyé');
      snapshot = { updatedAt:Date.now(), products:result, error:null };
      if (DB_URL && DB_KEY) {
        try { await saveProductsToDatabase(result); }
        catch (dbError) { dbSync.error=String(dbError.message).replaceAll(DB_KEY, '[CLÉ MASQUÉE]'); console.error('Synchronisation Supabase :',dbSync.error); }
      }
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
    if (url.pathname === '/api/sync-status') {
      res.writeHead(200, {...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({catalogCount:snapshot.products.length, catalogUpdatedAt:snapshot.updatedAt, databaseConfigured:Boolean(DB_URL&&DB_KEY), databaseLastSyncAt:dbSync.updatedAt, databaseCount:dbSync.count, catalogError:snapshot.error, databaseError:dbSync.error}));
    }
    if (url.pathname === '/api/catalog') {
      if (!snapshot.updatedAt || Date.now()-snapshot.updatedAt>TTL) await syncCatalog();
      else if (DB_URL && DB_KEY && dbSync.count === 0) {
        try { await saveProductsToDatabase(snapshot.products); }
        catch (dbError) { dbSync.error=String(dbError.message).replaceAll(DB_KEY, '[CLÉ MASQUÉE]'); console.error('Synchronisation Supabase :',dbSync.error); }
      }
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
