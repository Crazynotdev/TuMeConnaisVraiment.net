# TuMeConnaisVraiment (Waz-moi)

Description
-----------
TuMeConnaisVraiment est une application web simple et responsive permettant de créer des quiz personnels (5 à 10 questions) à partager avec des amis via un lien unique. Les participants répondent sans compte, reçoivent leur score et l'auteur du quiz peut consulter un tableau des scores.

Principales fonctionnalités
- Création de quiz (5–10 questions) avec choix multiples et une seule bonne réponse par question.
- Lien unique généré pour partage (WhatsApp, Instagram, etc.).
- Participation sans compte.
- Tableau de scores listant les réponses reçues.
- Design responsive et fun (emoji, barres de progression).
- Espace prévu pour régie publicitaire (AdSense placeholder).

Installation rapide
-------------------
1. Copier le projet.
2. npm install
3. npm start
4. Ouvrir http://localhost:3000

Structure
---------
- server.js — Serveur Express, routes et logique.
- data/db.sqlite — base SQLite (créée automatiquement).
- views/ — templates EJS (pages).
- public/ — CSS et JS client.
- package.json — dépendances et scripts.

Notes
-----
- AdSense : remplacer le placeholder dans les vues par le code fourni par la régie.
- Pour production : mettre derrière un reverse-proxy (Nginx), activer HTTPS, surveiller la base SQLite ou adapter vers PostgreSQL/MySQL si montée en charge.
- Sécurité : valider davantage les données côté client/serveur et appliquer rate-limits si nécessaire.

Bon développement !
