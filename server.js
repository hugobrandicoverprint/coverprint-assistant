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
const AI_KEY = (process.env.GEMINI_API_KEY || '').trim();
const AI_MODEL = (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite').trim();
// Modele de secours configurable dans Render. Ne jamais essayer une liste illimitee.
const AI_FALLBACK_MODEL = (process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite').trim();
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
    status:'active',synced_at:new Date().toISOString(),tags_raw:p.tags || ''
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
          result.push({ id:p.id, title:p.title, handle:p.handle, description: String(p.body_html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&eacute;/g,'é').slice(0,5000), type:p.product_type || '', tags: Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags || ''), image:p.images?.[0]?.src || null, vendor:p.vendor || '', available:p.variants?.some(v=>v.available) ?? null, variants:(p.variants||[]).map(v=>({id:String(v.id),title:v.title,sku:v.sku||'',price:v.price,available:v.available})), url:`${STORE}/products/${encodeURIComponent(p.handle)}` });
        }
        if (page === 100) throw new Error('Catalogue trop volumineux : limite de synchronisation atteinte');
      }
      if (!result.length) throw new Error('Aucun produit public renvoyé');
      snapshot = { updatedAt:Date.now(), products:result, error:null };
      // Ne jamais bloquer une demande client sur la sauvegarde en base.
      // Les produits chargés sont immédiatement utilisables par le conseiller IA.
      if (DB_URL && DB_KEY) {
        void saveProductsToDatabase(result).catch(dbError => {
          dbSync.error=String(dbError.message).replaceAll(DB_KEY, '[CLÉ MASQUÉE]');
          console.error('Synchronisation Supabase :', dbSync.error);
        });
      }
    } catch(err) {
      snapshot.error = err.message;
      // Preserve prior good snapshot if refresh fails.
    } finally { pending = null; }
    return snapshot;
  })();
  return pending;
}

// Les contraintes obligatoires sont appliquées AVANT le modèle IA.
const norm = x => String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const forbidden = /\b(masquer catalogue|masquer-catalogue|decoupe sur mesure produit technique)\b/;
function getConstraints(question){
  const q=norm(question);
  const glueNegated = /\b(ne veux pas|veux pas|pas besoin de|plus besoin de|m en fou|je m en fiche|oublie|sans importance)\b.{0,35}\b(sans colle|sans adhesif|electrostatique)\b/.test(q);
  return {sansColle:!glueNegated && /\b(sans colle|sans adhesif|non adhesif|electrostatique|statique sans colle)\b/.test(q),
    lowTack:/\b(low tack|lowtack|faible adherence)\b/.test(q),
    latex:/\blatex\b/.test(q), uv:/\b(impression uv|imprimable uv|encre uv)\b/.test(q),
    eco:/\b(eco solvant|ecosolvant)\b/.test(q),
    sol:/\b(pour le sol|au sol|sur le sol|poser au sol|revetement de sol|marquage au sol)\b/.test(q),
    interieur:/\b(pose interieure|pose a l interieur|film interieur)\b/.test(q),
    exterieur:/\b(pose exterieure|pose a l exterieur|film exterieur)\b/.test(q)};
}
function eligible(p,c){
  const title=norm(p.title), evidence=norm([p.title,p.type,p.tags,p.description].join(' '));
  if(forbidden.test(evidence))return false;
  if(c.sol && !/\b(sol|plancher|floor|floor graphic|floorgraphics)\b/.test(norm(p.title+' '+p.type+' '+p.tags)))return false;
  if(c.sol && /\b(vitrage|film solaire|film de securite|pour vitre)\b/.test(title))return false;
  // En cas de doute on élimine, jamais d'inférence technique par le LLM.
  if(c.sansColle && !/\b(sans colle|sans adhesif|non adhesif|electrostatique|static cling)\b/.test(evidence))return false;
  if(c.sansColle && /\b(adhesif permanent|colle permanente|low tack|lowtack)\b/.test(evidence))return false;
  if(c.lowTack && !/\b(low tack|lowtack|faible adherence)\b/.test(evidence))return false;
  if(c.latex && (!/\blatex\b/.test(evidence) || /\b(non compatible latex|pas compatible latex|latex non compatible)\b/.test(evidence)))return false;
  if(c.uv && !/\b(impression uv|imprimable uv|uv led|uv print)\b/.test(evidence))return false;
  if(c.eco && !/\b(eco solvant|ecosolvant)\b/.test(evidence))return false;
  if(c.interieur && /\b(exterieur uniquement|pose exterieure uniquement)\b/.test(evidence))return false;
  if(c.exterieur && /\b(interieur uniquement|pose interieure uniquement)\b/.test(evidence))return false;
  if(p.available===false)return false;
  return true;
}
function shortlist(question){
  const c=getConstraints(question), q=norm(question), tokens=q.split(' ').filter(t=>t.length>3&&!['cherche','pour','avec','dans','sans','produit','besoin','veux','film'].includes(t));
  const products=snapshot.products.filter(p=>eligible(p,c)).map(p=>{
    const name=norm(p.title), tags=norm(p.tags+' '+p.type), desc=norm(p.description);
    let score=0;for(const t of tokens){if(name.includes(t))score+=8;if(tags.includes(t))score+=5;if(desc.includes(t))score+=1;}
    if(c.sansColle && /sans colle|electrostatique/.test(name+' '+tags))score+=15;
    if(c.lowTack && /low tack/.test(name+' '+tags))score+=15;
    return {p,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,25).map(x=>x.p);
  return {products,c};
}
function listingRequest(question){
  const q=norm(question);
  const coverStyl=/\bcover\s?styl\b/.test(q);
  const grey=/\b(gris|grise|grises|grey|gray|graphite|anthracite)\b/.test(q);
  // Une demande Cover Styl + couleur exprime une recherche de gamme, meme sans "toutes".
  // Ex. "je veux un cover styl film gris" ne doit pas etre reduit a trois suggestions IA.
  return coverStyl && grey;
}
function catalogueListing(question){
  // Only explicitly marked shades in product title/tags: no invented color classification.
  const results=snapshot.products.filter(p=>{
    const title=norm(p.title), tags=norm(p.tags), handle=norm(p.handle);
    if(!(/\bcover styl\b/.test(title+' '+tags+' '+handle))) return false;
    if(/nuancier|echantillon|book|kit|accessoire|outil/.test(title)) return false;
    if(!/\b(gris|grise|grises|grey|gray|graphite|anthracite)\b/.test(title+' '+tags)) return false;
    return p.available!==false && !forbidden.test(norm(p.title+' '+p.tags));
  }).sort((a,b)=>a.title.localeCompare(b.title,'fr'));
  return {reply:results.length ? `J’ai trouvé ${results.length} références Cover Styl explicitement identifiées comme grises, Grey/Gray, Graphite ou Anthracite dans les noms ou tags du catalogue. Voici la liste ; cliquez sur « Afficher la suite » pour les parcourir. D’autres décors peuvent paraître gris sans être nommés ainsi : ils ne sont pas inclus automatiquement.` : 'Aucune référence ne porte explicitement ces mots de couleur dans son nom ou ses tags. Je ne peux pas garantir un inventaire visuel exhaustif sans données couleur vérifiées.',products:results.map(p=>({id:p.id,title:p.title,url:p.url,image:p.image,type:p.type})),source:'catalogue-exhaustif',total:results.length};
}
// Reconstitue une précision courte envoyée par l'interface (ex. « bla,n » => « blanc »).
// L'ancienne demande reste le cahier des charges ; la précision est une préférence.
function parseFollowup(question){
  const m=String(question).match(/^Demande précédente\s*:\s*([\s\S]*?)\.\s*Réponse du client à la dernière question\s*:\s*([\s\S]*?)\.\s*Tenez compte de cette précision/i);
  if(!m)return null;
  const goal=m[1].trim();
  let value=m[2].trim();
  if(/^bla\s*[,.;-]?\s*n(?:c)?$/i.test(value)||/^blnac$/i.test(value))value='blanc';
  const n=norm(value);
  const shade=/^(blanc|blanche|white|transparent|transparente|noir|noire|gris|grise|gray|grey)$/.test(n)?n:null;
  return {goal,value,shade};
}
function matchesShade(p,shade){
  if(!shade)return true;
  const text=norm(p.title+' '+p.tags+' '+p.description.slice(0,250));
  const synonyms={blanc:/\b(blanc|blanche|white)\b/,blanche:/\b(blanc|blanche|white)\b/,white:/\b(blanc|blanche|white)\b/,transparent:/\b(transparent|transparente|clear)\b/,transparente:/\b(transparent|transparente|clear)\b/,noir:/\b(noir|noire|black)\b/,noire:/\b(noir|noire|black)\b/,gris:/\b(gris|grise|gray|grey)\b/,grise:/\b(gris|grise|gray|grey)\b/,gray:/\b(gris|grise|gray|grey)\b/,grey:/\b(gris|grise|gray|grey)\b/};
  return Boolean(synonyms[shade]?.test(text));
}
// Un appel peut échouer temporairement en HTTP 503 sans que le modèle soit supprimé.
// Budget total inférieur au timeout de 45s du navigateur. Jamais de boucle infinie.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function generateGeminiWithRecovery(payload){
  const deadline = Date.now()+39000;
  const models = [AI_MODEL];
  if(AI_FALLBACK_MODEL && AI_FALLBACK_MODEL !== AI_MODEL) models.push(AI_FALLBACK_MODEL);
  let lastError = null;
  for(let modelIndex=0;modelIndex<models.length;modelIndex++){
    const model = models[modelIndex];
    for(let attempt=1;attempt<=2;attempt++){
      const remaining=deadline-Date.now();
      if(remaining<1800) break;
      try {
        const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
          method:'POST',
          headers:{'x-goog-api-key':AI_KEY,'Content-Type':'application/json'},
          body:payload,
          signal:AbortSignal.timeout(Math.min(10000,Math.max(1500,remaining-1000)))
        });
        if(response.ok) {
          if(attempt>1||modelIndex>0)console.log(`Gemini : reprise reussie (modele ${model}, tentative ${attempt})`);
          return response.json();
        }
        // Ne jamais afficher le contenu brut de Google (pour éviter de divulguer des informations).
        const status=response.status;
        let code='';let msg='';
        try{const error=(await response.json()).error||{};code=String(error.status||'');msg=String(error.message||'');}catch{}
        const temporary=[408,500,502,503,504].includes(status);
        const kind=status===404?'MODELE_INDISPONIBLE':status===429?'QUOTA':status===401?'CLE_INVALIDE':status===403?'AUTORISATION':temporary?'TEMPORAIRE':'AUTRE';
        lastError=new Error(`Gemini HTTP ${status} [${kind}] ${code}`);
        // Un code 404 peut justifier le modèle de secours; un quota ou une clé invalide, non.
        if(status===404)break;
        if(!temporary)throw lastError;
        console.warn(`Gemini : HTTP ${status} sur ${model}, tentative ${attempt}/2`);
      }catch(err){
        if(err?.message?.startsWith('Gemini HTTP') && !err.message.includes('[TEMPORAIRE]'))throw err;
        if(err?.name==='TimeoutError'||err?.name==='AbortError')lastError=new Error('Gemini : délai de réponse dépassé [TEMPORAIRE]');
        else if(err?.message?.startsWith('Gemini HTTP')) lastError=err;
        else lastError=new Error('Gemini : connexion indisponible [TEMPORAIRE]');
        console.warn(`Gemini : erreur temporaire sur ${model}, tentative ${attempt}/2`);
      }
      if(attempt===1){
        const pause=Math.min(900+Math.floor(Math.random()*350),Math.max(0,deadline-Date.now()-1500));
        if(pause>0)await sleep(pause);
      }
    }
    if(modelIndex===0 && models.length>1 && Date.now()<deadline-1800){
      console.warn(`Gemini : bascule vers le modele de secours ${models[1]}`);
    }
  }
  throw lastError || new Error('Gemini : service temporairement indisponible [TEMPORAIRE]');
}

async function advise(question, history=[]){
  if(!snapshot.updatedAt) {
    // En cas de démarrage à froid, le premier catalogue doit être chargé.
    await Promise.race([syncCatalog(), new Promise((_, reject)=>setTimeout(()=>reject(new Error('Catalogue en cours de chargement : réessayez dans un instant.')), 25000))]);
  } else if(Date.now()-snapshot.updatedAt>TTL) {
    // Le catalogue déjà chargé reste exploitable pendant son actualisation.
    void syncCatalog();
  }
  // Sur une précision courte, les critères obligatoires viennent du besoin précédent,
  // tandis que la couleur ne peut pas remplacer ces critères.
  const followup=parseFollowup(question);
  const effectiveQuestion=followup?followup.goal:question;
  // Les critères obligatoires proviennent du besoin actif, jamais des autres anciens projets.
  // Ne jamais réinjecter un ancien besoin rejeté dans les filtres.
  if(!followup && listingRequest(question)) return catalogueListing(question);
  const c0=getConstraints(effectiveQuestion);
  if(c0.sansColle && c0.lowTack)return {reply:'Vous avez demandé à la fois « sans colle » et « low tack ». Un produit low tack possède un adhésif faible ; un produit sans colle n’en possède pas. Lequel recherchez-vous ?',products:[],source:'clarification'};
  const initial=shortlist(effectiveQuestion);
  const products=followup?.shade?initial.products.filter(p=>matchesShade(p,followup.shade)):initial.products;
  const c=initial.c;
  if(!products.length && followup){
    const color=followup.shade?`la finition « ${followup.value} »`:`la précision « ${followup.value} »`;
    return {reply:`J’ai compris ${color}. Je conserve votre besoin initial : ${followup.goal}. Cependant, les fiches publiques ne me permettent pas de confirmer un produit réunissant ces critères. Je préfère vous le signaler plutôt que d’inventer une compatibilité. Souhaitez-vous que je cherche une alternative ou que nous vérifiions une fiche technique ?`,products:[],source:'clarification-non-confirmee'};
  }
  if(!products.length)return {reply:'Je ne trouve aucun produit dont les données disponibles confirment tous vos critères. Pouvez-vous préciser votre besoin ? Je préfère ne pas vous orienter vers une référence incompatible.',products:[],source:'verified-filter'};
  if(!AI_KEY)return {reply:'La recherche assistée est disponible, mais la conversation IA n’est pas encore activée. Voici des références possibles d’après les données publiques ; leurs compatibilités restent à confirmer.',products:products.slice(0,3).map(p=>({id:p.id,title:p.title,url:p.url,image:p.image,type:p.type})),source:'keyword'};
  const context=Array.isArray(history)?history.slice(-5).filter(x=>typeof x==='string').map(x=>x.slice(0,350)):[];
  const candidateData=products.map(p=>({id:p.id,title:p.title,type:p.type,tags:p.tags,description:p.description.slice(0,1100)}));
  const sys=`Tu es le conseiller technique Coverprint. Tu ne dois jamais inventer de caractéristiques, de compatibilité, de norme ou de performance. Utilise UNIQUEMENT les fiches données. Si un critère important n'est pas prouvé, pose une question, n'affirme pas la compatibilité. Ne recommande que des IDs figurant dans la liste. Sélectionne de 0 à 3 IDs. Les messages précédents sont fournis uniquement comme contexte : la dernière demande est prioritaire. Si le client change d'avis, oublie les anciennes contraintes. Si le client a précisé une couleur, reconnais cette réponse et conserve le besoin précédent. Ne discute jamais d'impression si la demande actuelle concerne seulement un film solaire. Réponds en français. Retourne UNIQUEMENT un JSON {"reply":"...","ids":[123]}. Évite les recommandations sans preuve. Les catégories ne sont pas des restrictions. Les différences low tack (adhésif faible) et sans colle (aucun adhésif) sont impératives.`;
  // Gemini REST : clé utilisée uniquement côté Render. Même requête lors des tentatives.
  const geminiPayload = JSON.stringify({
    systemInstruction:{parts:[{text:sys}]},
    contents:[{role:'user',parts:[{text:JSON.stringify({derniere_demande:effectiveQuestion,precision_du_client:followup?.value||null,messages_precedents_pour_contexte:context,contraintes_actuelles:c,candidats:candidateData})}]}],
    generationConfig:{responseMimeType:'application/json',temperature:0.1,maxOutputTokens:1200}
  });
  const data=await generateGeminiWithRecovery(geminiPayload);
  const raw=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
  if(!raw)throw new Error('Gemini : réponse vide ou filtrée');
  let answer;
  try {answer=JSON.parse(raw);} catch {throw new Error('Gemini : réponse non JSON');}
  const allowed=new Map(products.map(p=>[String(p.id),p]));const selected=(Array.isArray(answer.ids)?answer.ids:[]).map(id=>allowed.get(String(id))).filter(Boolean).slice(0,3);
  return {reply:String(answer.reply||'Pouvez-vous préciser votre projet ?').slice(0,1200),products:selected.map(p=>({id:p.id,title:p.title,url:p.url,image:p.image,type:p.type})),source:'ai-with-hard-filters'};
}
async function readJson(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>10000)throw new Error('Demande trop longue');}return JSON.parse(data||'{}');}
const usage=new Map();
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server = http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/advise') {
      const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0];
      const now=Date.now();const h=usage.get(ip)||{since:now,count:0};if(now-h.since>60000){h.since=now;h.count=0;}h.count++;usage.set(ip,h);
      if(h.count>12){res.writeHead(429,{...headers,'Content-Type':'application/json'});return res.end(JSON.stringify({reply:'Trop de demandes. Réessayez dans une minute.',products:[]}));}
      const body=await readJson(req);const question=String(body.question||'').trim().slice(0,1200);const history=Array.isArray(body.history)?body.history:[];
      if(!question){res.writeHead(400,headers);return res.end('Question requise');}
      try {const answer=await advise(question,history);res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(answer));}
      catch(e){const diagnostic=String(e.message).replaceAll(AI_KEY||'__aucune_cle__','[MASQUÉ]'); console.error('Conseil :',diagnostic);res.writeHead(503,{...headers,'Content-Type':'application/json'});return res.end(JSON.stringify({reply:diagnostic.includes('Catalogue en cours')?'Le catalogue se charge après le redémarrage de l’application. Veuillez réessayer dans quelques instants.':diagnostic.includes('[TEMPORAIRE]')?'Le service Gemini est momentanément surchargé. Nous avons tenté automatiquement une reconnexion et un modèle de secours. Veuillez réessayer un peu plus tard.':diagnostic.includes('[QUOTA]')?'La limite de l’IA gratuite Gemini est atteinte pour le moment. Les produits Coverprint restent accessibles, mais les réponses IA sont suspendues.':diagnostic.includes('[CLE_INVALIDE]')?'La clé Gemini est refusée. Vérifiez GEMINI_API_KEY dans Render.':diagnostic.includes('[MODELE_INDISPONIBLE]')||diagnostic.includes('HTTP 404')?'Le modèle Gemini est indisponible. Vérifiez GEMINI_MODEL dans Render.':diagnostic.includes('[AUTORISATION]')?'Votre projet Google n’autorise pas ce modèle Gemini. Vérifiez les permissions et le forfait dans AI Studio.':'L’IA est momentanément indisponible. Consultez les logs Render pour voir le code d’erreur précis.',products:[],error:'service_unavailable'}));}
    }
    if (req.method !== 'GET') { res.writeHead(405, headers); return res.end(); }
    if (url.pathname === '/api/sync-status') {
      res.writeHead(200, {...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({catalogCount:snapshot.products.length, catalogUpdatedAt:snapshot.updatedAt, databaseConfigured:Boolean(DB_URL&&DB_KEY), databaseLastSyncAt:dbSync.updatedAt, databaseCount:dbSync.count, catalogError:snapshot.error, databaseError:dbSync.error, aiConfigured:Boolean(AI_KEY),aiProvider:'Gemini',aiModel:AI_MODEL}));
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

// Précharge le catalogue dès le démarrage, sans bloquer le serveur HTTP.
setImmediate(()=>{ void syncCatalog().catch(err=>console.error('Préchargement catalogue:', String(err.message))); });
