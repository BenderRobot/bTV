# Convergence bTV Tizen — isolation des données 1.3.0

## Reprise du 4 novembre 2026 — données communes

Référence produit : Android 2.12.41, commit `1b6e7ff`. Priorité confirmée : profils,
favoris, reprise et synchronisation. Premier prérequis livré localement : séparation
par compte IPTV des favoris, historique, progression/Vu, pistes, catégories masquées
et suivi des épisodes. Le profil local reste Principal implicite ; aucun sélecteur
familial ni synchronisation cloud n'est annoncé dans cette version.

Le coffre KeyManager conserve un registre serveur normalisé/utilisateur → identifiant
aléatoire. Les clés de données utilisent cet identifiant, sans compte ni mot de passe.
Il reste stable après redémarrage, déconnexion et changement de mot de passe. Ce
registre local n'est pas une clé du transport Android : la future synchronisation
devra appliquer exactement le contrat Android, qui inclut le mot de passe dans sa
clé cloud. Limite locale de 32 comptes, sans éviction automatique.

L'ancien compte mémorisé est identifié avant une nouvelle connexion. Lui seul peut
recevoir les données globales historiques ; les entrées contenant une URL étrangère
sont exclues. Les anciennes données sans URL ne permettent pas une attribution
certaine si plusieurs comptes avaient été mélangés auparavant : elles sont associées
au compte mémorisé, pas aux comptes connectés ensuite. S'il n'y avait aucun compte
mémorisé, les données historiques restent en réserve, sans attribution automatique.
La copie originale n'est jamais supprimée. Une migration interrompue ou refusée par
le quota peut être réessayée ; une liste explicitement vidée n'est pas réimportée.
Une réponse tardive du suivi des épisodes n'écrit pas dans le nouveau compte.

Validation locale : 39 tests Node, ESLint, 6 tests du contrôle WGT, build SDK,
signature avec le profil existant et inspection de l'archive 1.3.0 réussis.
Paquet : `.buildResult/MyIPtv.wgt`. Aucune installation Samsung, aucun push ou
déploiement réalisé dans ce lot. Recette restante : mise à niveau sans désinstallation,
conservation des favoris/reprises, déconnexion/reconnexion et passage entre comptes.

Suite : profils familiaux/PIN sur iOS et Tizen, puis mapping des identifiants de média
et synchronisation des favoris/reprises avec suppressions et conflits horodatés.

## Historique — accueil 1.2.0

Branche `feature/platform-convergence`, PR https://github.com/BenderRobot/bTV/pull/8.
La cible de validation est une Samsung récente. Le lecteur AVPlay/HLS existant
reste utilisé. Ce lot prépare l'activation commune avec Android/iOS ; les profils,
la synchronisation et la télécommande ne sont pas encore portés. L'utilisateur
a confirmé l'installation et l'activation de la version 1.1.0 sur sa Samsung.
La version 1.2.0 reste à tester ; aucune publication automatique n'est faite.

## Référence visuelle

L'application Android TV est la référence du portage : mêmes couleurs, logo,
typographies, cartes d'accueil, mur d'affiches, fiches de médias et organisation
des commandes. Adapter la réalisation HTML/CSS et le focus à la télécommande
Samsung, en conservant cette présentation. L'interface Tizen historique n'est
pas encore entièrement alignée ; ce travail accompagne les prochains lots.

### Accueil 1.2.0

- Cartes dans l'ordre Android TV : Rediffusion, En direct, Favoris, Séries, Films.
  Favoris est sélectionné au démarrage. En-tête conservant compte, actualisation
  et réglages ; message d'accueil selon l'heure, fond discret et contour vert.
- Grandes affiches de reprise à partir des progressions locales, avec titre,
  épisode et barre d'avancement. Dernier épisode par série, contenus terminés
  exclus, chaînes récemment consultées avec logo entier. Maximum trente entrées.
- Les URL d'un autre serveur/compte sont écartées de cette rangée. Cela ne migre
  pas encore tous les anciens favoris/caches vers un espace par profil.
- Navigation Haut/Bas entre en-tête, cartes et affiches ; Gauche/Droite défile
  uniquement la rangée. OK demande la reprise habituelle ; quitter le lecteur
  revient à l'accueil avec l'affiche sélectionnée, même si la rangée a été triée.
- Place réservée au mini-lecteur et taille des affiches adaptée à la taille du texte.
  En l'absence d'historique, message explicatif et navigation limitée aux cartes.
- La recherche générale, les rangées de recommandations et le portage des fiches
  détaillées ne sont pas ajoutés dans ce lot. Les boutons Compte/Réglages conservent
  leurs fonctions existantes ; aucun bouton de profil sans fonctionnalité réelle.

Validation : 31 tests Node et ESLint, puis tests Edge avec service/coffre/média
simulés : connexion existante, sécurité des titres, parcours D-pad, défilement,
reprise et retour du lecteur, mini-lecteur, quatre tailles de texte et historique
vide. Captures de l'accueil inspectées. L'activation et ses refus ont également
été rejoués. La lecture native et le nouveau rendu restent à valider sur Samsung.

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

Le script exclut récursivement `.git/*` pour les clones complets, ainsi que les
outils de développement. Un contrôle de l'archive signée refuse les fichiers Git,
clés et chemins suspects avant toute installation, y compris avec `-SkipBuild`.
Les fixtures du contrôle sont testées par `tools/test-wgt.ps1` et dans la CI Windows.

Après `npm ci --ignore-scripts` :

```powershell
.\tizen-deploy.ps1 -VerifyOnly
.\tizen-deploy.ps1 -BuildOnly
```

`-VerifyOnly` exécute tests et ESLint sans SDK ni TV. `-BuildOnly` effectue ces
contrôles, le build SDK et la signature avec le profil `myiptv_cert`, sans installation
ni push Git. Le paquet est `.buildResult\MyIPtv.wgt`. L'identité
`bfgs9jFN9d.MyIPtv` est conservée, version 1.2.0. Conserver aussi le même certificat
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

## Validation du lot activation 1.1.0 (3 novembre 2026)

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
