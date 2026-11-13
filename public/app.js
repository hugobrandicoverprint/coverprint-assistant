const $=id=>document.getElementById(id);
const messages=$('messages'),input=$('input');
const categories={
 'Cover Styl':['Bois','Pierre','Béton','Couleur','Métal','Textile','Pailleté','Accessoires'],
 'Films pour vitrage':['Film solaire','Sécurité','Décoratif','Anti-UV','Anti-buée'],
 'Papiers':['Aqueux','Solvant','Latex','UV','Papier peint','Fine Art'],
 'Films adhésifs':['Permanent','Enlevable','Repositionnable','Vitrine','Sol / Floor Graphic'],
 'Films non adhésifs':['Adhésion sans colle','Films synthétiques','Impression latex / UV'],
 'Magnétiques':['Magnétique imprimable','Accessoires'],
 'Bâches & toiles':['Bâche','Toile','Textile'],
 'Double face photo':['Montage photo','Double face'],
 'Plastifications':['Mat','Brillant','Protection'],
 'Outillages & displays':['Pose et dépose','Découpe','Fixation','Roll up','Displays']};
let history=[],working=false;
// Corrige quelques fautes courantes sans réécrire arbitrairement les longues demandes.
function tidyReply(raw){
  return String(raw).trim()
    .replace(/\bbla\s*[,.;-]\s*nc\b/gi,'blanc')
    .replace(/\bblnac\b/gi,'blanc')
    .replace(/\bblancs?he?\b/gi,'blanc')
    .replace(/\btransparant(e)?\b/gi,'transparent$1')
    .replace(/\bbrillan\b/gi,'brillant');
}
function conversationQuestion(message){
  const normalized=tidyReply(message);
  // Une réponse courte doit être interprétée par rapport à l'échange précédent.
  const short=normalized.length<=35 && normalized.split(/\s+/).length<=6;
  const lastBot=[...history].reverse().find(x=>x.startsWith('Assistant : '));
  const lastGoal=[...history].reverse().find(x=>x.startsWith('Client : ') && x.length>42);
  if(short && lastBot && lastGoal){
    return `Demande précédente : ${lastGoal.slice(9,430)}. Réponse du client à la dernière question : ${normalized}. Tenez compte de cette précision pour conseiller le produit demandé.`;
  }
  return normalized;
}

function bubble(text,who='bot'){const b=document.createElement('div');b.className='bubble '+who;if(who==='bot'){const l=document.createElement('div');l.className='bot-label';l.textContent='ASSISTANT COVERPRINT';b.append(l)}b.append(document.createTextNode(text));messages.append(b);messages.scrollTop=messages.scrollHeight;return b}
function renderProducts(parent,products,source){if(!products?.length)return;const list=document.createElement('div');list.className='results';const full=source==='catalogue-exhaustif';let shown=0;const size=12;let more=null;function appendBatch(){for(const p of products.slice(shown,full?shown+size:products.length)){const a=document.createElement('a');a.className='result';a.href=p.url;a.target='_blank';a.rel='noopener noreferrer';if(p.image){const img=document.createElement('img');img.src=p.image;img.loading='lazy';img.alt='';a.append(img)}const d=document.createElement('div'),strong=document.createElement('strong'),label=document.createElement('small'),link=document.createElement('span');strong.textContent=p.title;label.textContent=p.type||'Produit Coverprint';link.className='link';link.textContent='Voir le produit ↗';d.append(strong,label,link);a.append(d);list.append(a)}shown=Math.min(products.length,full?shown+size:products.length);if(shown>=products.length && more)more.remove();}parent.append(list);appendBatch();if(full && products.length>shown){more=document.createElement('button');more.type='button';more.className='loadMore';more.textContent='Afficher la suite ('+(products.length-shown)+' restantes)';more.addEventListener('click',()=>{appendBatch();if(more.isConnected)more.textContent='Afficher la suite ('+(products.length-shown)+' restantes)';});parent.append(more)}}
function setBusy(b){working=b;const send=$('sendButton');send.disabled=b;send.classList.toggle('is-loading',b);send.setAttribute('aria-busy',String(b));}
function thinkingBubble(){const b=document.createElement('div');b.className='bubble bot pending';const label=document.createElement('div');label.className='bot-label';label.textContent='ASSISTANT COVERPRINT';const wrap=document.createElement('div');wrap.className='thinking';const orbit=document.createElement('div');orbit.className='think-orbit';orbit.setAttribute('aria-hidden','true');const copy=document.createElement('div');copy.className='thinking-copy';const t=document.createElement('strong');t.textContent='Recherche dans le catalogue';const s=document.createElement('small');s.textContent='Analyse de votre demande';const dots=document.createElement('span');dots.className='dots';dots.innerHTML='<i></i><i></i><i></i>';s.append(dots);copy.append(t,s);wrap.append(orbit,copy);b.append(label,wrap);messages.append(b);messages.scrollTop=messages.scrollHeight;return {b,t,s};}
async function submit(question){question=String(question||'').trim();if(!question||working)return;setBusy(true);input.value='';bubble(question,'user');const requested=conversationQuestion(question);const prior=history.slice(-8);history.push('Client : '+tidyReply(question));const pending=thinkingBubble();const phases=[['Recherche dans le catalogue','Identification des produits'],['Vérification des références','Contrôle des caractéristiques disponibles'],['Préparation de la réponse','Sélection des résultats pertinents']];let phase=0;const phaseTimer=setInterval(()=>{phase=Math.min(phase+1,phases.length-1);pending.t.textContent=phases[phase][0];pending.s.firstChild.textContent=phases[phase][1]},2600);const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);try{const response=await fetch('/api/advise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:requested,history:prior}),signal:controller.signal});const a=await response.json();pending.b.remove();const answer=a.reply||(response.ok?'Pouvez-vous préciser votre besoin ?':'La recherche n’a pas pu aboutir. Réessayez.');const message=bubble(answer,'bot');if(response.ok){history.push('Assistant : '+answer.slice(0,700));renderProducts(message,a.products,a.source);}}catch(err){pending.b.remove();bubble(err.name==='AbortError'?'La recherche prend trop de temps. Merci de réessayer dans quelques instants.':'Connexion momentanément indisponible. Veuillez réessayer.','bot');}finally{clearInterval(phaseTimer);clearTimeout(timeout);setBusy(false);messages.scrollTop=messages.scrollHeight;}}
function init(){const root=$('suggestions');root.innerHTML='';Object.entries(categories).forEach(([family,subs],i)=>{const container=document.createElement('div');container.className='familyBlock';const btn=document.createElement('button');btn.type='button';btn.textContent=family;btn.addEventListener('click',()=>{const open=container.classList.toggle('expanded');container.querySelector('.subs').hidden=!open});const sub=document.createElement('div');sub.className='subs';sub.hidden=true;subs.forEach(name=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.addEventListener('click',()=>submit('Je cherche un produit dans '+family+' : '+name));sub.append(b)});container.append(btn,sub);root.append(container)})}
$('composer').addEventListener('submit',e=>{e.preventDefault();submit(input.value)});input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit(input.value)}});$('reset').addEventListener('click',()=>{history=[];messages.innerHTML='';bubble('Bonjour ! Décrivez librement ce que vous recherchez, ou choisissez une famille ci-dessous.');input.focus()});init();
fetch('/api/sync-status').then(r=>r.json()).then(d=>{$('catalogStatus').textContent=d.catalogCount?'● '+d.catalogCount+' produits':'● Catalogue en attente'}).catch(()=>{$('catalogStatus').textContent='Catalogue indisponible'});
