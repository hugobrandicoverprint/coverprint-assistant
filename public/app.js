// COVERPRINT — lien vers la gamme complete apres une recherche Cover Styl gris.
// Ajouter ce bloc TOUT EN BAS de public/app.js (ne pas effacer le code existant).
// La collection officielle est verifiee. Le filtre "Couleur > Gris" se choisit sur le site.
(() => {
  const renderProductsOriginal = renderProducts;

  renderProducts = function (parent, products, source) {
    renderProductsOriginal(parent, products, source);

    const demande = String(history[history.length - 1] || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const chercheCoverStyl = /cover\s*styl|coverstyl/.test(demande);
    const chercheGris = /\bgris\b|\bgrise\b|\bgrey\b|\bgray\b|\bgraphite\b|\banthracite\b/.test(demande);
    if (!chercheCoverStyl || !chercheGris) return;

    const encart = document.createElement('div');
    encart.style.cssText = 'margin-top:14px;padding:15px;border:1px solid #e9d9db;border-radius:14px;background:#fff;';
    const titre = document.createElement('strong');
    titre.textContent = 'Explorer toute la gamme Cover Styl grise';
    titre.style.cssText = 'display:block;font-size:14px;margin-bottom:7px;color:#242329;';
    const aide = document.createElement('div');
    aide.textContent = 'Sur Coverprint, choisissez le filtre Couleur → Gris pour afficher toutes les references correspondantes, et pas seulement les recommandations de l’IA.';
    aide.style.cssText = 'font-size:12px;line-height:1.5;color:#666;margin-bottom:11px;';
    const lien = document.createElement('a');
    lien.href = 'https://coverprint.fr/collections/coverstyl';
    lien.target = '_blank';
    lien.rel = 'noopener noreferrer';
    lien.textContent = 'Voir tous les Cover Styl gris ↗';
    lien.style.cssText = 'display:inline-block;padding:11px 15px;border-radius:9px;background:#b32934;color:#fff;text-decoration:none;font-size:13px;font-weight:700;';
    encart.append(titre, aide, lien);
    parent.append(encart);
    messages.scrollTop = messages.scrollHeight;
  };
})();
