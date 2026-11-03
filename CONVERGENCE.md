# Convergence bTV Tizen

Cette branche conserve le lecteur AVPlay et les données locales. Elle prépare les vérifications de livraison ; le portage des licences, profils et synchronisation reste à faire.

Après `npm ci --ignore-scripts` :

```powershell
.\tizen-deploy.ps1 -VerifyOnly
.\tizen-deploy.ps1 -BuildOnly
```

`-VerifyOnly` exécute les tests puis ESLint sans Tizen Studio ni TV. Une erreur arrête le script. Le déploiement normal et `-BuildOnly` passent les mêmes contrôles avant leur build. `-BuildOnly` signe le paquet avec le profil Tizen existant, sans chercher de TV, installer ou pousser Git. `-SkipBuild` réutilise un paquet et n'exécute pas ces contrôles de source : ne pas présenter cette opération comme un nouveau build vérifié.

Une CI GitHub vérifie tests et lint. Elle ne dispose pas du certificat Samsung et ne prouve pas la signature, l'installation ou le fonctionnement AVPlay. Le nom/version/identité Tizen existants sont conservés pour éviter de casser les mises à jour des installations actuelles.

Le journal de refus d'authentification ne contient plus `user_info`, qui peut inclure des identifiants. Un correctif sans changement majeur du lockfile retire l'alerte haute de brace-expansion ; cinq alertes modérées liées aux dépendances de développement ESLint/minimatch restent à traiter. Aucun remplacement forcé de version d'ESLint n'est appliqué.

Le protocole commun des reçus et la matrice des fonctions se trouvent dans `platform/README.md` et `docs/CONVERGENCE_ANDROID_IOS_TIZEN_2026-11-03.md` de la branche Android `feature/platform-convergence`. Le reçu peut être produit après un build commité et contrôlé, puis importé dans la console admin ou enregistré avec son outil Python. Il ne donne pas au .wgt un mécanisme d'installation depuis l'application.

Validation de cette branche : 14 tests et ESLint réussis. La signature .wgt et le test de la TV ne sont pas effectués dans cette séance. Les clés génériques de localStorage et les secrets du compte devront être migrés avant un partage contrôlé par licences.
