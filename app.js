const $ = id => document.getElementById(id);
const messages = $('messages'), input = $('input'), suggestions = $('suggestions');
const normalize = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const words = s => normalize(s).split(/\s+/).filter(w=>w.length>=3);
const families = [
  {id:'impression', label:'support d’impression', hints:['impression','imprimer','imprimable','latex','ecosolvant','eco solvant','grand format','papier peint','vinyle','bache','adhesif imprimable','textile'], query:['impression','imprimable','vinyle','papier','support','media','bache']},
  {id:'outillage', label:'outillage de pose', hints:['outillage','outil','raclette','cutter','lame','grattoir','pulverisateur','maroufler','nettoyage','sott','olfa','unger'], query:['raclette','cutter','outil','sott','olfa','unger','triumph']},
  {id:'solaire', label:'film solaire', hints:['soleil','solaire','chaleur','chaleurs','chaud','temperature','canicule','uv','eblouissement','luminosite','lumiere','miroir','vis a vis','veranda','bureau','isolation'], query:['film solaire','solar screen']},
  {id:'securite', label:'film de sécurité', hints:['securite','effraction','anti effraction','bris','casse','protection','renforcer','renfort','vandalisme','impact','eclat'], query:['film securite','film anti effraction','clear 8','safe']},
  {id:'coverstyl', label:'revêtement Cover Styl', hints:['cover styl','coverstyl','renover','relooker','meuble','porte','cuisine','plan de travail','facade','bois','marbre','adhesif decoratif'], query:['cover styl','coverstyl','revêtement adhesif']},
  {id:'design', label:'film décoratif pour vitrage', hints:['depoli','occultant','opacite','intimite','discretion','decoratif','deco','vitrage decoratif','dichroique','vitrophanie'], query:['film design','film decoratif','depoli','dichroique']}
];
// Selected examples are only shown if the remote catalog cannot be retrieved.
const examples = [
  {title:'Clarity 333 XC',family:'solaire',tags:'clair neutre lumière luminosité extérieur chaleur',description:'Film solaire clair extérieur',url:'https://coverprint.fr/search?q=Clarity%20333%20XC'},
  {title:'Clarity 245 XC',family:'solaire',tags:'clair lumière luminosité extérieur chaleur',description:'Film solaire extérieur',url:'https://coverprint.fr/search?q=Clarity%20245%20XC'},
  {title:'Silver 385 XC',family:'solaire',tags:'argent miroir extérieur solaire chaleur',description:'Film solaire extérieur',url:'https://coverprint.fr/search?q=Silver%20385%20XC'},
  {title:'Spectra 33 C',family:'solaire',tags:'nano ceramique intérieur lumiere chaleur',description:'Film solaire intérieur',url:'https://coverprint.fr/search?q=Spectra%2033%20C'},
  {title:'Clear 8 XC',family:'securite',tags:'effraction renfort sécurité extérieur vitrage',description:'Film de sécurité',url:'https://coverprint.fr/search?q=Clear%208%20XC'},
  {title:'Clear 7 C',family:'securite',tags:'effraction renfort sécurité intérieur vitrage',description:'Film de sécurité',url:'https://coverprint.fr/search?q=Clear%207%20C'},
  {title:'Cover Styl NF40',family:'coverstyl',tags:'cover styl bois cuisine porte meuble',description:'Revêtement décoratif',url:'https://coverprint.fr/search?q=Cover%20Styl%20NF40'},
  {title:'Cover Styl NK10 Microcement Bone',family:'coverstyl',tags:'cover styl pierre beton meuble cuisine',description:'Revêtement décoratif',url:'https://coverprint.fr/search?q=NK10'},
  {title:'Mat Opal PET',family:'design',tags:'depoli intimite discretion vitrage',description:'Film décoratif pour vitrage',url:'https://coverprint.fr/search?q=Mat%20Opal%20PET'},
  {title:'Aurora Winter',family:'design',tags:'dichroique couleur decoration vitrage',description:'Film décoratif pour vitrage',url:'https://coverprint.fr/search?q=Aurora%20Winter'}
];
let catalog = [], isLive = false, conversation = [], family = null, answers = {};
function addBubble(text, who='bot') {
  const el = document.createElement('div'); el.className='bubble '+who;
  if(who==='bot'){const label=document.createElement('div'); label.className='bot-label';label.textContent='✦ ASSISTANT COVERPRINT';el.append(label)}
  el.append(document.createTextNode(text)); messages.append(el); messages.scrollTop=messages.scrollHeight; return el;
}
function chooseFamily(text) {
  const n=normalize(text); const score=families.map(f=>({id:f.id,score:f.hints.reduce((s,h)=>s+(n.includes(normalize(h))?normalize(h).includes(' ')?3:2:0),0)})).sort((a,b)=>b.score-a.score);
  return score[0].score>0?score[0].id:null;
}
function buttons(parent, values, type='reply') {
  const row=document.createElement('div'); row.className='followup';
  values.forEach(value=>{const button=document.createElement('button');button.type='button';button.textContent=value.label; button.addEventListener('click',()=>submit(value.label, value.value, type));row.append(button)});
  parent.append(row);
}
const stepConfigs = {
 impression:{key:'technologie',question:'Avec quelle technologie souhaitez-vous imprimer ?',choices:[['Latex','latex'],['UV','uv'],['Éco-solvant','eco solvant'],['Je ne sais pas','inconnu']]},
 outillage:{key:'objectif',question:'Quel type d’outil recherchez-vous ?',choices:[['Pose de films','raclette pose'],['Découpe','cutter découpe'],['Nettoyage / dépose','nettoyage grattoir']]},
 solaire:{key:'pose',question:'La pose sera-t-elle à l’intérieur ou à l’extérieur du vitrage ?',choices:[['Extérieur','extérieur'],['Intérieur','intérieur'],['Je ne sais pas','inconnu']]},
 securite:{key:'objectif',question:'Quel est le besoin principal pour ce vitrage ?',choices:[['Retarder une effraction','effraction'],['Retenir les éclats en cas de bris','bris'],['Autre / à définir','inconnu']]},
 coverstyl:{key:'support',question:'Quel support voulez-vous rénover ?',choices:[['Cuisine','cuisine'],['Porte ou meuble','meuble'],['Mur ou autre','mur']]},
 design:{key:'objectif',question:'Quel rendu recherchez-vous ?',choices:[['Dépoli / intimité','dépoli intimité'],['Coloré / décoratif','couleur décoratif'],['Opaque','opaque']]}
};
function scoreProduct(p, terms, selected) {
  const title=normalize(p.title), tags=normalize(p.tags), type=normalize(p.type), desc=normalize(p.description);
  let points=0;
  const f=families.find(x=>x.id===selected);
  if (p.family && p.family!==selected) return -100;
  if (p.family===selected) points+=12;
  if (f) for(const hint of f.query) {const h=normalize(hint); if(title.includes(h)) points+=10; else if(tags.includes(h)||type.includes(h)) points+=6; else if(desc.includes(h))points+=1;}
  if(selected==='impression' && /impression|imprimable|vinyle|papier|media|bache|textile/.test(title+' '+tags+' '+type))points+=12;
  if(selected==='outillage' && /outil|raclette|cutter|lame|grattoir|sott|olfa|unger|triumph/.test(title+' '+tags+' '+type))points+=12;
  if(selected==='coverstyl' && /cover styl|coverstyl/.test(title))points+=12;
  if(selected==='design' && /film design|film vitrage|depoli|opal|aurora|dichro/.test(title+' '+tags))points+=10;
  if(selected==='securite' && /securite|effraction|clear [0-9]|safe|protec/.test(title+' '+tags+' '+type))points+=10;
  if(selected==='solaire' && /solaire|silver|clarity|spectra|alu|chrome|natural/.test(title+' '+tags+' '+type))points+=8;
  for (const t of terms) {if(title.split(' ').includes(t))points+=8; else if(title.includes(t))points+=5; if(tags.includes(t))points+=4; if(type.includes(t))points+=4; if(desc.includes(t))points+=Math.min(2,desc.split(t).length-1);}
  if (answers.pose==='extérieur' && /exterieur|\bxc\b/.test(title+' '+tags))points+=8;
  if (answers.pose==='intérieur' && /interieur|\bc\b/.test(title+' '+tags))points+=5;
  if(selected==='solaire' && /luminosite|lumiere|clair|transparent/.test(terms.join(' ')) && /clarity|spectra|clair|neutre/.test(title+' '+tags))points+=8;
  if(selected==='design' && /depoli|intimite/.test(terms.join(' ')) && /depoli|opal|discretion/.test(title+' '+tags))points+=10;
  if(p.available===false)points-=20;
  return points;
}
function renderResults() {
  const terms=words(conversation.join(' ')+' '+Object.values(answers).join(' '));
  const scored=catalog.map(p=>({p,score:scoreProduct(p,terms,family)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const picks=scored.slice(0,3).map(x=>x.p);
  if(!picks.length) {addBubble('Je ne trouve pas de correspondance suffisamment fiable dans le catalogue disponible. Voici une recherche sur Coverprint pour continuer :'); const e=addBubble('Recherche produits →'); e.style.cursor='pointer';e.onclick=()=>window.open('https://coverprint.fr/search?q='+encodeURIComponent(conversation.join(' ').slice(0,120)),'_blank','noopener');return;}
  const wrap=addBubble(isLive?'Voici les références qui semblent les plus proches de votre besoin. Vérifiez la compatibilité sur chaque fiche produit.':'Voici quelques références d’exemple à explorer. Le catalogue complet n’a pas pu être chargé : ces suggestions ne sont pas des recommandations techniques validées.');
  const list=document.createElement('div');list.className='results';
  picks.forEach(p=>{
    const a=document.createElement('a');a.className='result';a.href=p.url;a.target='_blank';a.rel='noopener noreferrer';
    if(p.image && /^https:\/\//.test(p.image)){const img=document.createElement('img');img.src=p.image;img.alt='';img.loading='lazy';a.append(img)}else{const empty=document.createElement('div');empty.className='imgEmpty';empty.textContent='◈';a.append(empty)}
    const info=document.createElement('div');const title=document.createElement('strong');title.textContent=p.title;
    const label=document.createElement('small');label.textContent=p.type||p.description?.slice(0,75)||'Produit Coverprint';const link=document.createElement('span');link.className='link';link.textContent=isLive?'Voir la fiche produit ↗':'Rechercher sur Coverprint ↗';info.append(title,label,link);a.append(info);list.append(a);
  });wrap.append(list);
  const more=addBubble('Vous pouvez aussi préciser votre demande (type de vitrage, dimensions, priorité : chaleur, luminosité, intimité…) pour affiner la sélection.');
  buttons(more,[{label:'Privilégier la lumière',value:'Je privilégie la lumière naturelle'},{label:'Priorité à la protection',value:'Je privilégie la protection'},{label:'Recommencer',value:'reset'}]);
}
function submit(display, value=display, type='reply') {
  if(value==='reset'){reset();return;}
  const text=String(display).trim();if(!text)return;
  addBubble(text,'user');conversation.push(String(value));input.value='';
  if(type==='family')family=value;
  if(!family){family=chooseFamily(String(value));if(!family){const b=addBubble('Je peux vous aider. Dans quelle famille de produits se situe votre projet ?');buttons(b,[{label:'Impression',value:'impression'},{label:'Film solaire',value:'solaire'},{label:'Cover Styl',value:'coverstyl'},{label:'Sécurité',value:'securite'},{label:'Film décoratif',value:'design'},{label:'Outillage',value:'outillage'}],'family');return;}}
  const cfg=stepConfigs[family];
  if(type==='answer')answers[cfg.key]=value;
  if(cfg && !answers[cfg.key]){const b=addBubble(cfg.question);buttons(b,cfg.choices.map(([label,value])=>({label,value})),'answer');return;}
  renderResults();
}
function reset(){conversation=[];family=null;answers={};document.querySelectorAll('[data-family]').forEach(b=>b.classList.remove('active'));messages.innerHTML='';addBubble('Bonjour ! Décrivez votre projet et je vous aiderai à identifier les références pertinentes.');input.focus()}
$('composer').addEventListener('submit',e=>{e.preventDefault();submit(input.value)});
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit(input.value)}});
document.querySelectorAll('[data-family]').forEach(b=>b.addEventListener('click',()=>{ reset(); document.querySelectorAll('[data-family]').forEach(other=>other.classList.toggle('active',other===b)); const labels={impression:'Je cherche un support pour impression',solaire:'Je cherche un film solaire',coverstyl:'Je cherche un revêtement Cover Styl',securite:'Je cherche un film de sécurité',design:'Je cherche un film décoratif pour vitrage',outillage:'Je cherche des outils de pose'}; submit(labels[b.dataset.family],b.dataset.family,'family');}));
$('reset').addEventListener('click',reset);
(async()=>{try{const res=await fetch('/api/catalog');if(!res.ok)throw Error('Réponse indisponible');const data=await res.json();if(data.source==='live'&&data.products.length){catalog=data.products;isLive=true;$('catalogStatus').textContent=`● ${data.count} produits synchronisés`;$('catalogStatus').style.color='#257c52'}else{throw Error(data.error||'Aucun produit')} }catch(err){catalog=examples;isLive=false;$('catalogStatus').textContent='Mode démonstration';$('catalogStatus').title='Catalogue en ligne indisponible : '+err.message;}})();
