const $=id=>document.getElementById(id);
const messages=$('messages'),input=$('input');
const categories={
 'Cover Styl':['Bois','Pierre / Stone','Couleur','Métal','Organic','Glitter'],
 'Films pour vitrage':['Film solaire','Sécurité','Décoratif','Anti-UV','Anti-buée'],
 'Papiers':['Papier peint','Papier photo','Fine Art'],
 'Films adhésifs':['Permanent','Enlevable','Low tack','Vitrine','Impression'],
 'Films non adhésifs':['Sans colle','Électrostatique','Imprimable'],
 'Magnétiques':['Magnétique imprimable','Accessoires'],
 'Bâches & toiles':['Bâche','Toile','Textile'],
 'Double face photo':['Montage photo','Double face'],
 'Plastifications':['Mat','Brillant','Protection'],
 'Outillages & displays':['Raclettes','Découpe','Pose','Displays']};
const icons=['🎨','☀️','📜','🟥','◻️','🧲','🧵','🖼️','🛡️','🧰'];
let history=[],working=false;
function bubble(text,who='bot'){const b=document.createElement('div');b.className='bubble '+who;if(who==='bot'){const l=document.createElement('div');l.className='bot-label';l.textContent='✦ ASSISTANT COVERPRINT';b.append(l)}b.append(document.createTextNode(text));messages.append(b);messages.scrollTop=messages.scrollHeight;return b}
function renderProducts(parent,products){if(!products?.length)return;const list=document.createElement('div');list.className='results';for(const p of products){const a=document.createElement('a');a.className='result';a.href=p.url;a.target='_blank';a.rel='noopener noreferrer';if(p.image){const img=document.createElement('img');img.src=p.image;img.loading='lazy';img.alt='';a.append(img)}const d=document.createElement('div'),strong=document.createElement('strong'),label=document.createElement('small'),link=document.createElement('span');strong.textContent=p.title;label.textContent=p.type||'Produit Coverprint';link.className='link';link.textContent='Voir le produit ↗';d.append(strong,label,link);a.append(d);list.append(a)}parent.append(list)}
async function submit(question){question=String(question||'').trim();if(!question||working)return;working=true;input.value='';bubble(question,'user');history.push(question);const response=bubble('Recherche dans le catalogue Coverprint…');try{const r=await fetch('/api/advise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:history.slice(-4).join(' | ')})});const a=await r.json();response.lastChild.textContent=a.reply||'Pouvez-vous préciser votre besoin ?';renderProducts(response,a.products)}catch{response.lastChild.textContent='Le service est momentanément indisponible. Réessayez.'}finally{working=false;messages.scrollTop=messages.scrollHeight}}
function init(){const root=$('suggestions');root.innerHTML='';Object.entries(categories).forEach(([family,subs],i)=>{const container=document.createElement('div');container.className='familyBlock';const btn=document.createElement('button');btn.type='button';btn.textContent=icons[i]+' '+family;btn.addEventListener('click',()=>{const open=container.classList.toggle('expanded');container.querySelector('.subs').hidden=!open});const sub=document.createElement('div');sub.className='subs';sub.hidden=true;subs.forEach(name=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.addEventListener('click',()=>submit('Je cherche un produit dans '+family+' : '+name));sub.append(b)});container.append(btn,sub);root.append(container)})}
$('composer').addEventListener('submit',e=>{e.preventDefault();submit(input.value)});input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit(input.value)}});$('reset').addEventListener('click',()=>{history=[];messages.innerHTML='';bubble('Bonjour ! Décrivez librement ce que vous recherchez, ou choisissez une famille ci-dessous.');input.focus()});init();
fetch('/api/sync-status').then(r=>r.json()).then(d=>{$('catalogStatus').textContent=d.catalogCount?'● '+d.catalogCount+' produits':'● Catalogue en attente'}).catch(()=>{$('catalogStatus').textContent='Catalogue indisponible'});
