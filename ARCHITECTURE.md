# ARCHITECTURE.md — Magic Clipper for Google Drive (MC4GD)
## État de la Codebase — v1.13.0 — Juillet 2026

> Documentation technique d'architecture pour le projet MC4GD.

---

## 1. Vue d'Ensemble de l'Architecture

MC4GD est une extension Firefox MV3 indépendante et autonome. Elle suit une architecture stricte de séparation des responsabilités en couches de script, sans injection de code dans les pages de l'utilisateur (zéro Content Script).

```
┌─────────────────────────────────────────────────────────────────┐
│  POPUP (src/popup/)                                             │
│  - popup.html : Structure de l'interface (100% data-i18n)       │
│  - popup.css  : Thème (Clair/Sombre natif), Glassmorphism, UX   │
│  - popup.js   : Machine à états UI, onboarding, actions         │
│  * Strictement local : AUCUNE requête réseau directe            │
└────────────────┬────────────────────────────────────────────────┘
                                 │ browser.runtime.sendMessage
                                 │ sendResponse({ success, ... })
┌────────────────────────────────▼────────────────────────────────┐
│  BACKGROUND (src/background/background.js)                      │
│  - Event Page MV3 (éveillé à la demande, non persistant)        │
│  - Gestionnaire d'identité (OAuth2 implicite)                  │
│  - Logique API Drive v3 (recherche, création, upload résumable) │
│  - Sécurité (SSRF / Validation IP privées)                      │
│  * Logique métier : AUCUNE manipulation de DOM                  │
└────────────────┬────────────────────────────────────────────────┘
                                 │ fetch()
                                 ├──► accounts.google.com (Révocation de token)
                                 └──► www.googleapis.com (Drive API v3)
```

### Principes Fondamentaux
1. **Zéro Content Script** : L'extension n'a pas accès au DOM de la page web visitée. Elle s'appuie sur l'analyse de l'onglet actif et sur un téléchargement sécurisé du document depuis le background.
2. **Zéro Serveur Tiers** : L'upload se fait directement du navigateur vers l'API Google Drive. Aucune donnée ne transite par un serveur externe de stockage.
3. **i18n Intégral** : Aucun texte statique en dur. Le chargement et l'application des langues se font au démarrage via un moteur interne partagé.

---

## 2. Arborescence Détaillée (v1.12.0)

```
magic-clipper-drive/
├── manifest.json              # Manifeste MV3 Firefox (permissions, Event Page, locales)
├── LICENSE                    # Licence MPL-2.0 du projet
├── README.md                  # Présentation générale et guide d'utilisation
├── PLAN_ACTION.md             # Planification globale et suivi des sprints
├── CHANGELOG.md               # Historique des versions et modifications
├── _locales/                  # Dictionnaires de traduction i18n
│   ├── en/messages.json       # Locale de référence (anglais, toujours complète)
│   ├── fr/messages.json       # Français
│   ├── de/messages.json       # Allemand
│   ├── es/messages.json       # Espagnol
│   ├── vi/messages.json       # Vietnamien
│   └── gcf/messages.json      # Kréyòl (sélection manuelle en popup)
├── icons/
│   └── icon.svg               # Icône vectorielle unique (~13 Ko), squircle dégradé + trombone
├── tools/
│   └── check-i18n.js          # Script Node.js de validation et cohérence des traductions
└── src/
    ├── background/
    │   └── background.js      # Event Page: OAuth2, détection MIME, API Google Drive
    ├── popup/
    │   ├── popup.html         # Interface utilisateur
    │   ├── popup.css          # Design et styles (mode sombre, animations, focus)
    │   └── popup.js           # Contrôleur UI de la popup
    └── shared/
        └── utils.js           # Module partagé: MIME_MAP, initI18n, t(), getFileNameFromUrl, resolveDownloadUrl
```

---

## 3. Justification des Permissions et Sécurité

Le fichier `manifest.json` définit strictement les permissions minimales requises par l'extension :

*   **`identity`** : Nécessaire pour instancier le flux d'autorisation OAuth2 Google en mode silencieux ou interactif via `browser.identity.launchWebAuthFlow()`.
*   **`storage`** : Persiste l'état de l'utilisateur (`accessToken`, `expiresAt`, `folderId`, `locale` choisie, l'indicateur d'onboarding `hasSeenWelcome`, et `activeUpload` — état d'upload persisté pour survie au suspend).
*   **`tabs`** : Permet au background de lire l'URL et le titre de l'onglet actif avec `browser.tabs.query({ active: true, currentWindow: true })`.
*   **`host_permissions`** :
    *   `https://www.googleapis.com/*` : Indispensable pour interagir avec les endpoints de l'API Google Drive v3 (recherche de dossier, création de dossier, sessions d'upload résumables).
    *   `https://accounts.google.com/*` : Requis pour révoquer proprement le token d'accès Google lors de la déconnexion.
    *   `<all_urls>` : Requis pour permettre au background script de télécharger le fichier d'origine via un `fetch()` avant de le renvoyer vers Drive (puisque les fichiers comme les PDFs peuvent provenir de n'importe quel domaine public sur le web).

### Sécurité Réseau (Protection SSRF)
Avant de lancer un `fetch()` sur une URL détectée, le script exécute `isPrivateOrLoopback(url)`. Si l'hôte correspond à :
*   `localhost` ou des domaines se terminant par `.local` ou `.localhost`
*   Des adresses IP de réseau privé IPv4 (RFC 1918 : `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
*   Des adresses de lien local (`169.254.0.0/16` pour les métadonnées de serveurs cloud)
*   Des adresses de bouclage IPv6 (`::1`) ou des plages ULA / lien local IPv6
*   Des adresses **IPv4-mapped IPv6** (`::ffff:192.168.x.x`) — détectées via le helper interne `isPrivateIPv4Parts()`

La requête est immédiatement rejetée avec l'erreur `err_private_network` pour éviter toute attaque par contrefaçon de requête côté serveur (SSRF) depuis l'extension vers des services internes de l'utilisateur.

### Limitation Connue : DNS Rebinding

**Mécanisme de l'attaque** : Le DNS rebinding consiste à exploiter le TTL d'un enregistrement DNS pour changer l'IP résolue d'un domaine public (`attacker.com`) vers une IP privée (`192.168.1.1`) après qu'une première résolution légitime a eu lieu. `isPrivateOrLoopback()` vérifie l'hôte de l'**URL affichée** dans la barre d'adresse, pas l'adresse IP réelle utilisée au moment du `fetch()`.

**Pourquoi c'est un risque limité en pratique** :
1. Firefox intègre une défense contre les TTL courts suspects et les rebindings vers des plages RFC 1918 (DNS rebinding protection native).
2. L'attaque nécessite le contrôle d'un domaine public **ET** une synchronisation temporelle précise (la popup doit être ouverte dans la fenêtre de rebinding).
3. L'extension n'envoie les fichiers que vers `www.googleapis.com` (domaine dur-codé, non configurable). Seul le **téléchargement source** est potentiellement sujet au rebinding — les données utilisateur sur le réseau local ne sont pas émis vers un serveur contrôlé par un attaquant, mais vers Google Drive.

**Classification** : **Risque accepté**. La mitigation complète (résolution DNS au niveau extension avec validation de l'IP réelle) n'est pas réalisable sans API WebExtensions dédiée. Les facteurs atténuants (protections Firefox, complexité de l'attaque, destination Drive fixée) réduisent le risque résiduel à un niveau acceptable.

---

## 4. Logique du Module Partagé (`utils.js`)

Le fichier `src/shared/utils.js` centralise les outils utilisés à la fois par la popup et le background :

*   **`MIME_MAP`** : Table de correspondance entre 32 extensions courantes et leurs types MIME officiels.
*   **`initI18n(forcedLocale)`** : Charge d'abord l'anglais comme base de secours (fallback) puis tente de charger le JSON de traduction associé à la langue du système ou à la langue choisie par l'utilisateur. Si la locale demandée n'est pas autorisée, l'anglais prend le relais.
*   **`t(key, substitutions)`** : Retourne le message traduit associé à la clé en interpolant dynamiquement des variables définies sous forme de placeholders `$VAR$`.
*   **`getFileNameFromUrl(url, title)`** : Extrait et sanitise le nom de fichier depuis l'URL de l'onglet via la fonction interne `sanitize()` qui applique quatre passes dans l'ordre : (1) remplacement des caractères interdits par les systèmes de fichiers (`< > : " / \ | ? *` → `_`), (2) suppression des caractères de contrôle (U+0000–U+001F, U+007F), (3) suppression des overrides directionnels Unicode (U+202A–U+202E, U+2066–U+2069) qui permettraient d'afficher un nom trompeur en RTL, (4) troncature à 200 caractères (extension conservée). En cas d'absence d'extension ou de résultat non vide, elle utilise le titre de l'onglet sanitizé ou la chaîne par défaut `"file"`.

---

## 5. Logique Background (`background.js`)

### 5.1 Détection Dynamique des Fichiers (`detectFileFromTab`)
Le background utilise une double heuristique :
1. **Analyse de l'URL** : Extraction du dernier segment du chemin de l'URL de l'onglet actif. Si l'extension est présente dans `MIME_MAP`, le fichier est considéré comme supporté.
2. **Fallback Requête HEAD** : Si l'URL n'a pas d'extension valide, le background exécute une requête HTTP `HEAD` avec timeout (15s). Il inspecte l'en-tête `Content-Type` de la réponse pour voir s'il correspond à un format listé dans `MIME_MAP`. Il vérifie également `Content-Length` en amont pour interdire les fichiers de plus de **200 Mo** (`MAX_FILE_SIZE`) avant tout téléchargement.

### 5.2 Flux d'Autorisation Google Drive
L'extension évite de déranger l'utilisateur avec des fenêtres contextuelles d'autorisation OAuth2 à chaque envoi :
```
[Demande de Token] ──► Token en cache valide ? ──(Oui)──► Retourne le token
                          │
                        (Non)
                          ▼
             [Tentative OAuth Silencieuse] ────(Succès)──► Met en cache + Retourne
                          │
                       (Échec)
                          ▼
            [Ouverture de la Popup OAuth] ─────(Succès)──► Met en cache + Retourne
                          │
                       (Échec)
                          ▼
                   [Erreur Auth]
```

### 5.3 Gestion Mutex du Dossier Parent (`getOrCreateFolder`)
Pour éviter des conflits et la création de dossiers doublons lors d'appels simultanés ou de clics rapides, la création du dossier `"Imports Magic Clipper"` est encadrée par un mutex asynchrone (`folderCreationPromise`).
*   Recherche du dossier existant : `files.list` trié par date de création descendante (`orderBy=createdTime desc`). Si plusieurs dossiers portent le même nom, l'extension réutilise le plus récent.
*   Création silencieuse si absent, mise en cache de l'ID du dossier dans le stockage local.

### 5.4 Upload Résumable Chunké & Résilience API
Les transferts s'effectuent en trois phases distinctes :
1. **Téléchargement sécurisé** du document d'origine depuis le background via un `fetch()` avec calcul de progression dynamique en lisant le `ReadableStream` de `response.body`. Une **validation du Content-Type** est effectuée pour rejeter les redirections vers des pages HTML déguisées (portails d'authentification).
2. **Initialisation de session résumable** : POST vers l'API Google Drive v3 pour obtenir une URL de session résumable (`Location` header).
3. **Upload chunké** : Le fichier est découpé en morceaux de 8 Mo (`CHUNK_SIZE`) et envoyé chunk par chunk via `fetch()` avec des en-têtes `Content-Range`. Chaque chunk est confirmé par un `308 Resume Incomplete`, le dernier par un `200 OK`.

*   **Taille limite de 200 Mo** : Les fichiers dépassant cette limite sont rejetés en amont.
*   **Optimisation mémoire** : Seul un chunk de 8 Mo vit en mémoire à la fois (via `Blob.slice()`). Les chunks de téléchargement sont libérés dès la construction du Blob (`chunks.length = 0`).
*   **Persistance de l'état** : L'état d'upload (`phase`, `percent`, `sessionUrl`, `bytesUploaded`) est persisté dans `browser.storage.local` après chaque chunk. En cas de suspension du background (Event Page MV3), l'état est récupérable.
*   **Reprise réseau (R-01 & upload)** : En cas d'erreur réseau pendant le téléchargement initial ou l'upload, 3 retries avec backoff exponentiel (2s→4s→8s) sont tentés. Pour l'upload, la session résumable est interrogée (`Content-Range: bytes */{total}`) pour déterminer les octets déjà reçus par Google et reprendre au bon offset.
*   **Rafraîchissement préventif du token** : Avant de lancer l'upload, le temps de transfert est estimé (~3s/Mo). Si le token risque d'expirer pendant le transfert, il est rafraîchi préventivement.
*   **Annulation active (R-02 & Annuler)** : L'utilisateur peut interrompre le transfert à tout moment grâce au bouton Annuler (via `AbortController` dédiés), ou en naviguant vers une nouvelle page dans l'onglet actif, ce qui appelle `abort()` sur le transfert actif et nettoie l'état mémoire.
*   **Garde anti-double upload** : Un seul upload par onglet est autorisé. Les tentatives concurrentes sont rejetées avec un message d'erreur localisé.
*   **Résilience aux pannes API** :
    *   **Retries automatiques** : Jusqu'à 3 tentatives avec backoff exponentiel en cas d'erreur de limitation de débit (HTTP 429) ou de défaillance temporaire du serveur Google Drive (HTTP 5xx).
    *   **Retry de rattrapage unique** :
        *   HTTP 401 (token expiré) : invalidation + renouvellement + nouvelle tentative.
        *   HTTP 404 (dossier supprimé) : purge du cache `folderId` + recréation + nouvelle tentative.

---

## 6. Logique UI de la Popup (`popup.js`)

La popup implémente une machine à états stricte basée sur les messages asynchrones reçus du background.

### 6.1 Matrice de Routage des Messages
Le script de background écoute sur `browser.runtime.onMessage.addListener` et attend l'un des messages suivants :

| Action de Message | Paramètres | Rôle Background | Réponse |
|-------------------|------------|-----------------|---------|
| `getTabStatus` | Aucun | Détecte si l'onglet actif contient un fichier supporté | `{ supported: true, fileName, mimeType }` ou `{ supported: false, reason }` |
| `uploadCurrentFile` | Aucun | Démarre le flux de téléchargement et d'upload résumable vers Drive | `{ success: true, fileName, link }` ou `{ success: false, error }` |
| `getUploadStatus` | Aucun | Retourne l'état actuel d'un transfert actif pour cet onglet (reconnexion) | `{ phase: "downloading"\|"uploading"\|"success"\|"error", percent, fileName, mimeType, link, error }` ou `{ active: false }` |
| `cancelUpload` | Aucun | Interrompt le transfert en cours (téléchargement ou upload) | `{ success: true }` |
| `disconnect` | Aucun | Révoque le token Google OAuth2 et vide le stockage | `{ success: true }` |
| `getRedirectURL` | Aucun | Récupère l'URL de redirection de l'extension (pour débogage) | `{ url }` |

*Note de robustesse* : Le listener de messages retourne impérativement `true` de manière synchrone pour maintenir le port de communication ouvert lors des résolutions de promesses asynchrones.

### 6.2 Contrôle Visuel et États UI
*   **Onboarding** : Si la clé `hasSeenWelcome` n'existe pas dans le stockage local, un volet d'onboarding s'affiche en superposition avec un effet de verre dépoli (Glassmorphism réel permis par les orbes animées en CSS).
*   **Bouton de déconnexion double-clic** : Pour éviter les déconnexions accidentelles sans utiliser d'alerte bloquante `confirm()` (interdite ou non recommandée en extension moderne), le bouton passe dans un état de confirmation temporaire pendant 3 secondes (devient ambre avec texte sombre et la mention `"Confirmer la déconnexion"`). Si l'utilisateur clique à nouveau, la déconnexion s'exécute, sinon l'état est réinitialisé.
*   **Accessibilité Clavier** : Tous les éléments interactifs (`button`, `select`, `a`) gèrent la pseudo-classe `:focus-visible` pour afficher un anneau de sélection visuellement contrasté et esthétique pour les utilisateurs naviguant au clavier.