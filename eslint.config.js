// Config ESLint minimale : attrape les erreurs les plus couteuses sur un
// projet sans build (variables non declarees, redeclarations, code mort
// evident) sans imposer de style.
//
// Deux groupes de fichiers app (hors tests) :
// - js/utils.js : fonctions pures, autonome, aucune dependance vers les
//   autres fichiers. no-undef/no-unused-vars y restent totalement fiables.
// - js/app-shell.js, modals.js, data.js, browse.js, input.js, player.js,
//   bootstrap.js : l'ancien main.js (3400 lignes) decoupe en fichiers
//   thematiques, tous charges en <script> classiques dans le MEME ordre que
//   ci-dessus et partageant UNE SEULE portee globale (cf. l'en-tete de
//   js/app-shell.js) — exactement comme s'ils ne formaient qu'un seul
//   fichier. Consequence directe : no-undef ne peut pas etre fiable pour ce
//   groupe, puisque chacun de ces 7 fichiers reference librement des
//   fonctions/variables definies dans les autres (ex. input.js appelle des
//   fonctions de browse.js), qu'ESLint lint fichier par fichier sans
//   connaitre cet ordre de chargement. Meme probleme, en miroir, pour
//   no-unused-vars sur les declarations de premier niveau (une fonction
//   definie dans browse.js et appelee depuis input.js/player.js semble
//   "jamais utilisee" du point de vue de browse.js seul). Lister
//   exhaustivement chaque symbole partage comme "global" pour neutraliser
//   ces faux positifs serait une liste sans fin, vite perimee : les deux
//   regles sont donc desactivees pour ce groupe. no-redeclare et no-var
//   restent actifs et fiables puisqu'ils s'evaluent dans la portee de
//   chaque fichier, sans dependre de ce que font les autres. C'est le vrai
//   cout du decoupage "leger" choisi ici plutot que de vrais modules ES
//   (import/export) : la coherence inter-fichiers redevient une
//   responsabilite manuelle.
const globals = require('globals');

const appGlobals = {
    ...globals.browser,
    // API Tizen/Samsung, chargees par la plateforme (pas par un import)
    tizen: 'readonly',
    webapis: 'readonly',
    // Librairies chargees en <script> avant l'app (cf. index.html)
    Hls: 'readonly',
    lucide: 'readonly'
};

module.exports = [
    {
        files: ['js/utils.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...appGlobals,
                // Export CommonJS optionnel, utilise uniquement par les tests
                // (cf. typeof module !== 'undefined' en bas du fichier).
                module: 'readonly'
            }
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
            'no-redeclare': 'error',
            'no-var': 'warn'
        }
    },
    {
        files: ['js/app-shell.js', 'js/modals.js', 'js/data.js', 'js/browse.js', 'js/input.js', 'js/player.js', 'js/bootstrap.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: appGlobals
        },
        rules: {
            'no-undef': 'off', // cf. commentaire d'en-tete : portee globale partagee entre ces 7 fichiers
            'no-unused-vars': 'off', // idem, en miroir, pour les declarations de premier niveau
            'no-redeclare': 'error',
            'no-var': 'warn'
        }
    },
    {
        files: ['test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        }
    }
];
