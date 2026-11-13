# Coverprint Assistant — micro-application autonome

Une web-app mobile indépendante, sans modification de Shopify et sans clé API, pour explorer les produits publics de Coverprint.

## Lancer

1. Installer Node.js 18+.
2. Ouvrir un terminal dans ce dossier.
3. Lancer `npm start`.
4. Ouvrir http://localhost:3000.

Aucune commande `npm install` n'est nécessaire : aucune dépendance externe.

## Mettre en ligne

Déployer ce dossier sur un hébergeur Node.js (Render, Railway, VPS...). Commande de démarrage : `npm start`. Le service écoute `process.env.PORT` et toutes les interfaces. Configurer le domaine / sous-domaine de votre choix, avec HTTPS. Puis ouvrir l'adresse sur un téléphone et utiliser « Ajouter à l'écran d'accueil ».

## Données et limites

- Le serveur lit `https://coverprint.fr/products.json` page par page et conserve les produits en mémoire pendant trois heures. Il ne modifie jamais la boutique.
- En cas d'indisponibilité de la source ou d'absence de produits, l'interface passe en **mode démonstration** avec une liste d'exemples et des liens de recherche Coverprint.
- Le classement est un moteur **à règles / mots-clés**, pas une IA générative. Il sert à produire un premier outil simple à tester, sans abonnement IA.
- Les metafields privés, fiches PDF, contraintes de compatibilité, tarifs B2B et inventaires précis ne sont **pas** récupérés par cette source publique. Ne pas présenter les suggestions comme un conseil technique de pose validé.
- Pour une version commerciale fiable : prévoir une source structurée d'attributs techniques par produit (CSV/export Shopify ou API Admin autorisée) et une validation des règles métiers.
- Pas d'enregistrement des conversations côté serveur et pas de tracking ajouté.
- L'application n'est pas hébergée automatiquement : le zip est le projet à déployer.

## Catégories

Six boutons persistants sous la zone de message : Impression, Film solaire, Cover Styl, Sécurité, Film décoratif, Outillage & pose. Une question de qualification s’affiche selon le choix. Les produits ne sont recommandés que dans les limites des données du catalogue public.
