# bTV

Application IPTV pour Smart TV Samsung Tizen, en HTML5/CSS/JavaScript vanilla, utilisant l'API JSON Xtream Codes (`player_api.php`). Navigation entièrement pensée pour la télécommande.

## Fonctionnalités

- **Films / Séries / En Direct / Rediffusion / Favoris** depuis le menu d'accueil (dernier menu sélectionné mémorisé entre deux sessions).
- **Direct** : liste de chaînes avec panneau EPG (programme en cours + à suivre, frise horaire), mini-guide, favoris et suppression de l'historique.
- **Rediffusion (catchup/timeshift)** Xtream sur les chaînes compatibles (`tv_archive`).
- **Reprise de lecture** : proposition Reprendre/Recommencer (avec minuterie de 30s), progression et « Récemment consultés » mémorisés par contenu, épisodes de séries regroupés par émission.
- **Pistes audio multiples et sous-titres** (contenus tagués `MULTI`/`VOST`/`VOSTFR`) via l'API native Samsung AVPlay — `<video>`+hls.js seul ne les expose pas pour ce type de flux. Le choix de piste est mémorisé par contenu et réappliqué à la reprise.
- **Player** : navigation OSD au D-pad (lecture/pause, barre de progression, épisode suivant), reconnexion silencieuse du flux après une longue pause, relance automatique en cas d'erreur de lecture transitoire, indicateurs de chargement.
- **Écran de démarrage** avec préchargement des catégories (Films/Séries/Direct) pendant l'affichage de la barre de progression.
- **Recherche** de contenu et de catégories, mise en cache locale (localStorage) des catalogues déjà consultés pour limiter les requêtes réseau.
- **Paramètres** : changement de serveur, thème clair/sombre, informations de compte/abonnement, HUD de performances (FPS/mémoire/CPU) et journal de debug affichables à l'écran.

## Prérequis

- [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download) avec le CLI (`tizen.bat`, `sdb.exe`).
- Un profil de signature Tizen configuré (`tizen certificate` / `tizen security-profiles`).
- Une TV Samsung (ou l'émulateur Tizen TV) en mode développeur, sur le même réseau.
- Un abonnement IPTV compatible Xtream Codes (URL du serveur, identifiant, mot de passe).

## Déploiement

Le script [`tizen-deploy.ps1`](tizen-deploy.ps1) build, signe, installe et lance l'app sur la TV, puis propose de pousser les modifications sur GitHub.

```powershell
# Détecte automatiquement la dernière TV connue et déploie
.\tizen-deploy.ps1

# Se connecte explicitement à une TV par IP
.\tizen-deploy.ps1 -TvIp 192.168.1.50

# Liste les appareils Tizen visibles sans rien déployer
.\tizen-deploy.ps1 -ListDevices
```

Paramètres utiles : `-SkipBuild`, `-SkipInstall`, `-SkipRun`, `-SigningProfile`, `-TizenHome`.

## Configuration IPTV

Au premier lancement, renseigne l'URL du serveur, l'identifiant et le mot de passe Xtream Codes dans l'écran de connexion ; ils sont ensuite mémorisés localement (`localStorage`) pour une reconnexion automatique aux lancements suivants (modifiable depuis Paramètres).

## Structure du projet

```
config.xml           Manifeste de l'app Tizen (id, privilèges, profil TV)
index.html           Vues de l'app (login, accueil, navigation, lecteur, modales)
css/style.css        Styles
js/utils.js          Fonctions pures (formatage, cache, EPG...), testées unitairement
js/app-shell.js      Navigation racine, toasts, thème, accueil
js/modals.js         Modales Compte/Paramètres (HUD perf, journal de debug), reprise de lecture
js/data.js           API Xtream, caches, favoris/historique, progression
js/browse.js         Navigation Films/Séries/Direct/Rediffusion/Favoris
js/input.js          Dispatch de la télécommande vers l'écran actif
js/player.js         Lecture vidéo (<video>+hls.js, AVPlay), OSD, splash
js/bootstrap.js      Authentification et auto-login au démarrage
icon.png             Icône de l'app
tizen-deploy.ps1     Script de build/installation/déploiement + push Git
```

Les fichiers `js/*.js` (hors `utils.js`) sont chargés en `<script>` classiques dans cet ordre précis et partagent une seule portée globale — pas de bundler, pas de module ES (cf. l'en-tête de `js/app-shell.js`).

## Développement (tests / lint)

```powershell
npm install   # une seule fois
npm test      # tests unitaires (js/utils.js), via node --test
npm run lint  # ESLint
```
