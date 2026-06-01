# Mettre Sylanty en ligne (pour tester avec des prospects)

Objectif : obtenir une adresse `https://…` que tu peux ouvrir devant un client,
sur ton téléphone ou ton ordinateur. **Aucune installation sur ton PC.** Tout se fait
dans le navigateur. Gratuit, sans carte bancaire.

On utilise deux sites : **GitHub** (pour déposer le code) et **Render** (pour l'héberger).

---

## Étape 1 — Mettre le code sur GitHub

1. Va sur **github.com** et crée un compte gratuit.
2. En haut à droite, clique sur **+** puis **New repository**.
3. Donne un nom (ex : `sylanty`), laisse en **Public**, et clique **Create repository**.
4. Sur la page suivante, clique sur le lien **« uploading an existing file »**
   (téléverser un fichier existant).
5. Fais glisser dans la fenêtre **tous les fichiers du dossier `sylanty-app`** :
   - le dossier `public`
   - `db.js`, `server.js`
   - `package.json`, `package-lock.json`
   - `render.yaml`, `README.md`
   - (ne mets PAS de dossier `node_modules` — il ne doit pas y en avoir)
6. En bas, clique sur le bouton vert **Commit changes**.

> Tes fichiers sont maintenant en ligne sur GitHub.

---

## Étape 2 — Héberger sur Render

1. Va sur **render.com** et crée un compte avec le bouton **« Sign in with GitHub »**
   (connexion avec GitHub). Autorise l'accès quand il le demande.
2. Dans le tableau de bord, clique **New +** puis **Web Service**.
3. Sélectionne ton dépôt **sylanty** dans la liste.
4. Render détecte tout seul que c'est du Node.js. Vérifie simplement :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : **Free**
5. Clique **Create Web Service** (ou **Deploy**).
6. Attends 1 à 2 minutes. Quand c'est fini, Render affiche une adresse du type :
   **`https://sylanty.onrender.com`**

> C'est ton lien public. Tu peux l'ouvrir sur n'importe quel appareil.

Connexion démo : **demo@sylanty.fr** / **demo1234**

---

## Bon à savoir pour les démos

- **Mise en veille** : sur l'offre gratuite, l'app « s'endort » après 15 minutes
  sans visite. Le premier chargement après une pause prend ~30 à 60 secondes,
  puis tout est rapide. **Astuce** : ouvre ton lien 1 minute AVANT de montrer
  l'app à un prospect, pour qu'elle soit déjà réveillée.
- **Données de démo** : l'entreprise « Élec Pro Lyon » et son contenu sont rechargés
  automatiquement. Les éléments que tu crées pendant une démo peuvent disparaître
  après une mise en veille — c'est normal pour une version de test gratuite.
- **Mettre à jour l'app** : si tu modifies un fichier sur GitHub, Render redéploie
  tout seul la nouvelle version.

## Quand tu auras des clients qui paient

Pour une app fiable en continu (pas de mise en veille) et des données qui ne
s'effacent jamais, il faudra passer à une offre payante (quelques euros/mois) et,
pour la conformité, un hébergement de données en France. À voir à ce moment-là.
