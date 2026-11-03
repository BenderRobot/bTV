# Convergence bTV Tizen — activation 1.1.0

Branche `feature/platform-convergence`, PR https://github.com/BenderRobot/bTV/pull/8.
La cible de validation est une Samsung récente. Le lecteur AVPlay/HLS existant
reste utilisé. Ce lot prépare l'activation commune avec Android/iOS ; les profils,
la synchronisation et la télécommande ne sont pas encore portés. Aucun déploiement
sur la TV ni publication de mise à jour n'a été fait.

## Référence visuelle

L'application Android TV est la référence du portage : mêmes couleurs, logo,
typographies, cartes d'accueil, mur d'affiches, fiches de médias et organisation
des commandes. Adapter la réalisation HTML/CSS et le focus à la télécommande
Samsung, en conservant cette présentation. L'interface Tizen historique n'est
pas encore entièrement alignée ; ce travail accompagne les prochains lots.

## Parcours utilisateur

1. Au démarrage, la TV vérifie son activation avant de contacter le serveur IPTV.
2. Pour la première activation, scanner le QR depuis **bTV sur un téléphone déjà
   activé**, dans Réglages → Serveur → Activer une TV avec un QR code.
   Le QR expire après cinq minutes. Un code de secours à huit caractères est aussi
   accepté. Les deux parcours utilisent les RPC déjà employés par les autres apps.
3. La TV occupe une place du même accès. En cas de quota atteint, retirer un ancien
   appareil ou augmenter le quota depuis la console ; le code ne modifie pas le quota.
4. Après activation, un compte IPTV déjà enregistré est réutilisé ; sinon le formulaire
   habituel apparaît. **Le QR n'importe pas encore les identifiants IPTV du téléphone.**
5. Vérification toutes les 60 secondes au premier plan et au retour dans l'app.
   Une réponse explicite de révocation/expiration bloque la lecture. Pendant une panne
   réseau, un accès vérifié peut fonctionner pendant une heure au maximum depuis la
   dernière vérification, sans prolonger l'expiration du compte. Une révocation ne peut
   donc pas être connue instantanément hors connexion.
6. La mise en veille arrête la lecture et les requêtes périodiques. L'accès est revérifié
   à la reprise. Se déconnecter du compte IPTV efface ses identifiants, pas la licence.

## Stockage et compatibilité

L'identité d'installation, le jeton et les identifiants IPTV sont enregistrés dans
**Tizen KeyManager**, en deux copies alternées avec relecture avant suppression de
l'ancienne copie. Le compte historique `iptv_credentials` n'est retiré de localStorage
qu'après ce transfert réussi. Favoris, historique et caches existants sont conservés.
Ces données ne sont pas encore isolées par profil/compte dans ce lot.

Si le coffre natif manque ou refuse une écriture, l'app affiche une erreur et bloque
l'accès ; aucun secret n'est enregistré dans localStorage en remplacement. La version
minimale historique du manifeste ne constitue donc pas une promesse de compatibilité.
Samsung documente KeyManager depuis Tizen 2.4, et demande de **ne pas déclarer** le
privilège KeyManager depuis Tizen 3.0 :
https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/keymanager-api.html

Les scripts HLS, Lucide et QR sont inclus dans le paquet, avec versions fixes et
licences ; aucun script exécutable distant n'est chargé au démarrage. Leurs empreintes
sont vérifiées dans les tests. La configuration publique est dans `js/access-config.js` ;
ne jamais y placer une clé d'administration.

La télémétrie utilise `btv_device_check_platform` (migration commune
`20261104100000_btv_platform_builds.sql`, branche Android de convergence).
Si cette RPC manque avec HTTP 404, compatibilité avec `btv_device_check` ; la nouvelle
console affichera l'OS comme inconnu jusqu'à application de la migration.
Aucune migration supplémentaire n'est nécessaire pour le seul parcours QR/code.

## Construire et installer

Après `npm ci --ignore-scripts` :

```powershell
.\tizen-deploy.ps1 -VerifyOnly
.\tizen-deploy.ps1 -BuildOnly
```

`-VerifyOnly` exécute tests et ESLint sans SDK ni TV. `-BuildOnly` effectue ces
contrôles, le build SDK et la signature avec le profil `myiptv_cert`, sans installation
ni push Git. Le paquet est `.buildResult\MyIPtv.wgt`. L'identité
`bfgs9jFN9d.MyIPtv` est conservée, version 1.1.0. Conserver aussi le même certificat
pour mettre à jour une installation existante.

Pour installer après revue sur la TV de test :

```powershell
.\tizen-deploy.ps1 -TvIp <IP_DE_LA_TV> -NoPush
```

Le script normal installe et lance l'app. `-SkipBuild` réutilise un paquet existant et
ne valide pas les sources modifiées. Les dépendances de développement, tests, état de
déploiement et fichiers Git sont exclus du paquet. Un reçu dans la console ne donne
pas au WGT un mécanisme de mise à jour automatique dans l'app : le parcours Samsung
de distribution et d'installation reste à finaliser.

## Validation du 3 novembre 2026

- 27 tests Node et ESLint ; build SDK et signature réussis avec le profil existant.
- Archive inspectée : signatures présentes, identité/version attendues, licences incluses,
  absence de node_modules, tests, scripts de déploiement et fichiers Git.
- Edge avec service/coffre simulés : blocage avant activation, focus télécommande, code,
  QR approuvé par le serveur simulé, relance, révocation persistante et coffre absent.
- Captures 1920×1080 et 1280×720 inspectées ; QR décodé par un lecteur indépendant.
- **À valider sur Samsung réelle** : accès effectif au coffre, conservation après arrêt,
  clavier TV, scan depuis Android, lecture AVPlay, pause/reprise et révocation pendant lecture.
  Le build signé et les simulations ne prouvent pas ces comportements matériels.

La CI vérifie Node/ESLint mais ne dispose pas du certificat Samsung. Cinq alertes
modérées des dépendances de développement ESLint/minimatch restent connues. Aucun
`npm audit fix --force` n'a été utilisé. Le protocole des reçus et la matrice commune
sont dans `platform/README.md` et `docs/CONVERGENCE_ANDROID_IOS_TIZEN_2026-11-03.md`
du dépôt Android, PR #8.
