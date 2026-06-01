# Sylanty — Application full-stack (BTP / Conformité / DOE numérique)

Application web complète et fonctionnelle : back-end Node.js + base de données + front-end câblé.
Tous les boutons fonctionnent et **toutes les données sont enregistrées en base** (création de chantiers, dépôt de documents, validation de sous-traitants, passeports produits / DOE, partages, etc.).

## Lancer l'application (3 commandes)

```bash
npm install      # installe les dépendances (Express, Multer)
npm start        # démarre le serveur
```

Puis ouvrez **http://localhost:3000** dans votre navigateur.

> Node.js 22+ requis (la base SQLite est intégrée à Node, aucune installation de base de données nécessaire).

## Compte de démonstration

Cliquez sur **« Voir la démo »** ou **« Connexion »** :

- **Email** : `demo@sylanty.fr`
- **Mot de passe** : `demo1234`

L'entreprise de démo « Élec Pro Lyon SAS » est préchargée avec documents, salariés, chantiers, sous-traitants, risques et DOE.
Vous pouvez aussi créer un nouveau compte via **« Essai gratuit »** (votre SIRET → votre entreprise → c'est parti).

## Ce qui fonctionne (tout est persisté en base)

| Module | Actions réelles |
|--------|-----------------|
| **Authentification** | Inscription (crée entreprise + compte), connexion, déconnexion, reconnexion automatique |
| **Documents société** | Ajouter un document, déposer/téléverser un fichier (marque le doc conforme), score recalculé par code NAF |
| **Salariés** | Ajouter un salarié, consulter le dossier complet |
| **Chantiers** | Créer un chantier, filtrer par statut |
| **Sous-traitance** | Créer un sous-traitant (dossier 7 pièces), valider chaque document → statut recalculé |
| **Risques** | Ajouter un risque (ou « analyser un CCTP ») |
| **DOE & passeports produits** | Scanner/ajouter un produit à un DOE, transmettre le DOE au maître d'ouvrage (génère un lien + notification) |
| **Partages** | Créer un lien de partage sécurisé |
| **Collaboration** | Inviter un utilisateur avec un rôle |
| **Profil & réglages** | Modifier profil/entreprise, préférences de notifications |

## Architecture

```
sylanty-app/
├── server.js        ← back-end Express : API REST, authentification, upload
├── db.js            ← base SQLite : schéma + données de démo
├── package.json
├── public/
│   ├── index.html   ← front-end complet (votre maquette, câblée à l'API)
│   └── uploads/     ← fichiers téléversés
└── sylanty.db       ← base de données (créée automatiquement au 1er lancement)
```

- **Back-end** : Node.js + Express, base **SQLite** (module `node:sqlite` intégré).
- **Authentification** : mot de passe haché (scrypt), jeton signé (HMAC) stocké côté navigateur.
- **API REST** : `/api/auth/*`, `/api/bootstrap`, `/api/documents`, `/api/employees`, `/api/chantiers`, `/api/subcontractors`, `/api/risks`, `/api/doe/*`, `/api/shares`, `/api/invites`, `/api/profile`, `/api/settings/*`.
- **Front-end** : votre interface HTML/CSS intacte, les données chargées depuis l'API et chaque action enregistrée en base.

## Réinitialiser les données de démo

Supprimez le fichier de base et relancez :

```bash
rm sylanty.db*
npm start
```

## Notes

- Le port par défaut est `3000` (modifiable : `PORT=8080 npm start`).
- En production, définissez un secret : `SYLANTY_SECRET=...` et servez derrière HTTPS.
- L'avertissement `ExperimentalWarning: SQLite` est normal (SQLite intégré à Node) et sans conséquence.
