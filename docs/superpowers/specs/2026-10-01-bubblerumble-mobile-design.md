# Bubble Rumble mobile : design

- **Date :** 2026-10-01
- **Statut :** à relire
- **Référence protocole :** `gnoconnect-session.md` (`connect` étendu avec
  `pubkey` et `old`, host `disconnect`), comportement de la chaîne testé sur
  gnodev (gno `83e0a40ea`).
- **Révision 2026-10-01 :** les trois hosts `createsession`, `replacesession`
  et `revokesession` sont remplacés par `connect` / `disconnect`. La gestion des
  sessions reste l'affaire du wallet : la dapp ne fait que se connecter, avec ou
  sans sa propre clé, et se déconnecter.

## 1. Objectif

Jouer à Bubble Rumble sur mobile (iOS et Android) avec les mêmes fonctionnalités
que bubblerumble.net, **hors notifications push**, sans repasser par un wallet à
chaque transaction.

La dapp détient sa propre clé de session. La session est accordée une fois par
l'identité de l'utilisateur via gnokey-mobile (`connect` GnoConnect avec la
clé publique de la dapp), signée au desktop (option a), avec un budget horaire
et une durée longue. Si gnokey-mobile est absent, ou s'il répond un `connect`
sans session pour cette clé, la dapp propose elle-même la commande desktop
(repli intégré).

**Critères de réussite :**

1. Une première session s'obtient en un seul passage au desktop. Ensuite, chaque
   boop, claim et withdraw part sans quitter la dapp.
2. Renouveler, changer le budget ou révoquer passe par le même flux.
3. Toutes les fonctionnalités joueur du site sont présentes, y compris le
   off-chain (chat, rooms, etc.) branché sur les serveurs officiels, avec une
   URL configurable.
4. Tout fonctionne sur `gnoland-1` et sur un gnodev local.

## 2. Découpage

| # | Sous-projet | Dépôt | Dépend de |
|---|---|---|---|
| P1 | `SignBytes` dans gnonative | `~/gnonative` | — |
| P2 | Sessions GnoConnect dans gnokey-mobile (`connect` avec clé, `disconnect`) | `~/gnokey-mobile` | — |
| P3 | Dapp Bubble Rumble (Expo + gnonative) | `~/bubblerumble` | P1 (preuve de possession) ; P2 pour la voie gnokey-mobile, le repli fonctionne sans |

P1 et P2 sont indépendants. P3 commence dès que P1 est prêt, avec le repli
desktop, puis intègre la voie gnokey-mobile quand P2 est prêt.

## 3. P1 : gnonative, signature d'octets arbitraires

**Besoin.** La preuve de possession (`sig`, `oldsig`) signe un payload texte
avec la clé de session. Cette clé vit dans le keybase Go de gnonative, et
gnonative ne propose que `SignTx`.

**Ajout :** un RPC `SignBytes`.

```proto
rpc SignBytes(SignBytesRequest) returns (SignBytesResponse);
message SignBytesRequest  { bytes address = 1; bytes data = 2; }
message SignBytesResponse { bytes signature = 1; bytes pub_key = 2; } // pub_key : amino, comme KeyInfo.pub_key
```

- **Implémentation :** `keybase.Sign(name, password, data)` sur la clé désignée
  par `address`, en réutilisant le chemin de signature existant de `getSigner`.
  Format tm2 : secp256k1 sur SHA-256, 64 octets `R‖S`.
- **Exposition :** `GnoNativeApi.signBytes(address, data)` dans le module Expo.
- **`activateAccount(nameOrBech32, master?)` :** le champ `master` existe dans
  le proto et le service Go, mais pas dans la signature TypeScript. P1
  l'expose, sans quoi la dapp ne peut pas signer en session.
- **Tests :** test Go du service (signature vérifiable par
  `PubKey.VerifyBytes`, adresse inconnue → erreur typée), régénération
  `buf`/proto, build du module.
- **Hors périmètre :** toute autre évolution de gnonative.

## 4. P2 : gnokey-mobile, sessions via `connect` et `disconnect`

Implémentation de `gnoconnect-session.md` sur iOS et Android, avec la logique
dans `core/` (Go, partagé par les deux plateformes). gnokey-mobile implémente
déjà `connect` (branche `feat/deeplink-tx`) : P2 l'étend et ajoute le host
`disconnect`.

**`core/` (Go) :**

- **Parsing et validation** de `connect` (avec et sans `pubkey`, avec `old`,
  indications de périmètre) et de `disconnect`. Paramètres et bornes du spec : 8
  entrées maximum, `period` ≤ 30 j, `expires` ≤ ~4 ans, grammaire des allow
  entries, `old` ≠ `pubkey`, `signer` obligatoire avec `old` et sur
  `disconnect`.
- **Preuve de possession :** payload canonique, vérification `sig` / `oldsig`
  (secp256k1 et ed25519), fenêtre `iat`, mémoire anti-rejeu `(pubkey, state)`.
- **Pré-vérifications sur la chaîne :**
  - `pubkey` déjà session de l'identité : non expirée → réponse sans
    transaction, avec la session lue sur la chaîne ; expirée →
    `session_expired` ;
  - `old` encore présent ou non (absent : rien à révoquer, la revue le dit) ;
  - slot libre, sessions expirées révocables ;
  - `disconnect` : `pubkey` présent, sinon `session_not_found`.
- **Construction des transactions :**
  - `connect` sans `old` ni nettoyage : la commande `gnokey maketx session
    create …` ;
  - `connect` avec `old`, ou avec nettoyage : le document de transaction
    multi-messages (révocations puis création), plus la commande `gnokey sign
    -account-number -account-sequence … && gnokey broadcast -dry-run … &&
    gnokey broadcast …` ;
  - `disconnect` : la commande `gnokey maketx session revoke …` (ou le
    document multi-messages s'il y a du nettoyage).
- **Détection de l'issue** par polling de
  `auth/accounts/{maître}/session/{adresse}` : présence (`connect`) ou absence
  (`disconnect`). Le document est régénéré si la séquence du maître bouge.
- **Construction du callback** : `address`, `chainid`, `features` (avec
  `sessions`), `session`, `expires_at`, `allow`, `spend`, `period`, `revoked`
  (si `old` a été révoqué), `hash` (optionnel), `state` ; codes d'erreur du
  spec.
- **Indications de périmètre** (`connect` sans `pubkey`) : gnokey-mobile ne
  détient que des clés de session. Il lit les indications et vérifie si la
  session du compte choisi les couvre ; sinon l'écran de consentement propose
  d'en créer une, via le constructeur existant pré-rempli. Facultatif dans le
  standard, retenu dans P2 (décision du 2026-10-02) : le `core` dans P2-M1,
  l'écran dans P2-M2/M3.
- **Clé déjà session de l'identité, droits différents de la demande** : succès
  avec les valeurs de la chaîne, sans erreur ; la dapp compare et renouvelle
  avec `old` si elle a besoin d'autre chose (décision du 2026-10-02).
- **`spend` reste facultatif** à la création, comme dans le standard ; la revue
  dit clairement qu'une session sans `spend` ne peut rien dépenser, pas même
  ses frais.
- **Pont `mobile/`** : fonctions typées, comme l'existant.

**iOS et Android :**

- Routage dans `DeepLink.swift` / `DeepLink.kt` et `AppModel` /
  `AppViewModel` : `connect` choisit son écran selon la présence de `pubkey` ;
  `disconnect` est un nouveau host. `unsupported_host` reste la réponse aux
  hosts inconnus.
- **Écran de consentement** selon la section Review du spec :
  - hôte du callback, réseau (chain id + endpoint), identité ;
  - entrées autorisées, avec avertissement sur `*`, `vm/exec` nu, `vm/run` et
    `bank/*` ;
  - budget en clair et pire cas sur toute la durée, date d'expiration ;
  - avec `old`, la comparaison ancien / nouveau, ou la mention que l'ancienne
    clé n'est plus sur la chaîne ;
  - la possibilité de **restreindre** la demande (durée, budget, période,
    entrées), jamais de l'élargir.
- **Écran de passage au desktop** : réutilise `HandoffScreen` / `CommandBlock`
  (commande + QR). Il affiche l'attente sur la chaîne, propose l'annulation
  (→ `cancelled`) et garde la requête en attente si l'app passe en arrière-plan.
- **Sessions expirées** : proposition d'ajouter leur révocation dans la même
  transaction, visible dans la revue.
- **`connect`** : ajout de `sessions` dans `features`.

**Tests :**

- tests unitaires Go (payload, preuve, validation, construction des documents,
  callbacks) ;
- test d'intégration Go sur gnodev (`connect` avec clé, `connect` répété sur la
  même clé, `connect` avec `old` présent et absent, `disconnect`, nettoyage,
  rejets) ;
- tests du parseur côté Swift et Kotlin (le `DeepLinkTest.kt` existant sert de
  modèle).

## 5. P3 : dapp Bubble Rumble

### 5.1 Stack et structure

- **Framework :** Expo, dernier SDK (57), créé avec `npx create-expo-app@latest`,
  + expo-router + TypeScript. Si le module natif gnonative ne compile pas ou ne
  démarre pas en SDK 57, on se replie sur le SDK 54, déjà validé avec gnonative
  dans boards2-mobile.
- **gnonative :** archive locale produite par `npm pack` depuis
  `~/gnonative/expo` (branche `feat/sign-bytes`), tant que `SignBytes` n'est
  pas publié. Une archive passe mieux qu'un lien `file:` avec l'autolinking et
  Metro.
- **Dépôt :** `~/bubblerumble` (app Expo à la racine, `docs/` à côté).
- **Couches :**
  - `src/chain/` : gnonative (clés, session, appels, `Render` JSON) ;
  - `src/session/` : flux GnoConnect et repli desktop ;
  - `src/offchain/` : client HTTP du serveur officiel ;
  - `src/features/<fenêtre>/` : écrans ;
  - `src/state/` : état global (redux-toolkit ou zustand ; zustand par défaut,
    plus léger).

### 5.2 Configuration

| Réglage | Défaut | Modifiable |
|---|---|---|
| Réseau | `gnoland-1`, `https://rpc.gno.land:443` | oui (gnodev : `dev`, `127.0.0.1:26657`) |
| Realm | `…/bubblerumble5` (+ v1–v4 pour les anciens pools) | non |
| Serveur off-chain | `https://bubblerumble.net` | oui, URL libre |
| Wallet | schéma `land.gno.gnokey` | non |

### 5.3 Session

- **Première ouverture :**
  1. La dapp génère une clé dans le keybase gnonative (mot de passe stocké dans
     SecureStore).
  2. Elle propose le budget (GNOT par heure, 5 par défaut) et la durée (30 j par
     défaut).
  3. Elle envoie à gnokey-mobile un `connect` avec sa clé publique (`pubkey`),
     les entrées, le budget et la durée, et la preuve de possession via
     `SignBytes`.
- **Entrées autorisées** (7 sur 8) : `vm/exec:` pour bubblerumble5, 4, 3, 2 et
  1, `bubble` et `wbubble`.
- **Repli :** la dapp affiche elle-même la commande `gnokey maketx session
  create …` et un QR, puis détecte la session par polling. Trois cas y mènent :
  - gnokey-mobile répond au `connect`, mais sans session pour la clé de la dapp
    (`session` absent ou différent de l'adresse de `pubkey`) : il ne connaît
    pas encore l'extension. L'adresse maître est celle de la réponse, et le
    polling démarre tout de suite ;
  - l'app n'est pas installée : la dapp demande l'adresse maître (saisie ou
    collage) ;
  - l'utilisateur choisit « Utiliser un ordinateur » pendant l'attente :
    adresse saisie ou collée.
- **Après l'accord :** `ActivateAccount(clé, maître)`. La dapp vérifie sur la
  chaîne (`QuerySessionAccount`) l'expiration, le plafond, la période et les
  entrées autorisées.
- **Écran Session :**
  - budget restant (règle de remise à zéro), solde du maître, expiration ;
  - boutons « Renouveler / changer le budget » (`connect` avec une nouvelle
    clé et `old` = la clé actuelle, une seule transaction), « Révoquer »
    (`disconnect`) et « Recharger » (QR de l'adresse maître) ;
  - bandeau d'avertissement à J-3 de l'expiration.
- **Rejets de la chaîne,** traduits en actions :
  - budget épuisé → « rechargé dans mm:ss » ;
  - session expirée ou révoquée → renouveler ;
  - solde insuffisant → recharger.

### 5.4 Fonctionnalités

Inventaire tiré du site (JS public). La colonne « Source » indique d'où viennent
les données.

**Jalon M1 : jeu (on-chain)**

| Fonctionnalité | Source |
|---|---|
| Liste des pools (pot, horloge, leader, prix suivant), vue « bulles » simplifiée | `Render json` |
| Détail d'un pool : horloge, historique des boops, roster et gains, shots, répartition, règles | `Render json/<id>` |
| Boop : drapeau, « your clock » (100/50/25/10 %), shot optionnel avec cote | `Bid`, `ClockFor`, `ShotBps` |
| Claim, Cancel (créateur), Withdraw ; « mes gains » | `Claim`, `Cancel`, `Withdraw`, `Render me/<addr>` |
| Création de pool (nom, fenêtre, prix de base, durée, seed) | `CreatePool` |
| Équipes (drapeaux) | `Render teams` |
| Parrainage : lien d'invitation `?ref=`, ouverture de la dapp par lien (Universal / App Links en option, schéma `bubblerumble://` sinon), `ref` transmis à `Bid` | lien, `Bid` |
| Partage d'un pool (X, Telegram, système) | — |
| Anciens pools v1–v4 : lecture, Claim et Withdraw (Withdraw n'existe qu'à partir de v3) | realms v1–v4 |
| Présence : battement toutes les 20 s pendant que l'app est au premier plan ; il renvoie le pays du client | `POST /presence?id=<pid>` (`X-Bid`) |
| **Blocage US**, comme le site : si le pays renvoyé est `US`, boop, création et shots sont désactivés avec le texte du site (« Due to US regulations, play is not offered to visitors from the United States. »). Claim et Withdraw restent possibles, comme sur le site. Si le serveur est injoignable, le jeu reste ouvert, comme sur le site | `/presence` |
| Liens de partage au format du site (`https://bubblerumble.net/?ref=<addr>#v5-12`), lisibles par le web | — |

**Jalon M2 : social (off-chain)**

| Fonctionnalité | Endpoints |
|---|---|
| Chat principal : lire, poster, répondre, éditer, supprimer, réactions, votes, épingles (lecture), signalement, « en train d'écrire » | `/api/chat` (GET/POST/PATCH/DELETE), `/react`, `/vote`, `/report`, `/typing`, `/withdraw` |
| Pièces jointes : images et fichiers, messages vocaux (enregistrement, lecture, lecture auto en file) | `/api/chat/file`, `/api/chat/clip` |
| Nom réservé, profil, avatar | `/api/name`, `/api/profile`, `/api/avatar` |
| Rooms publiques et privées, invitations | `/api/rooms`, `/api/room`, `/api/room/invite` |
| Messages directs, amis | `/api/dm`, `/api/friends` |
| Appairage avec le navigateur (code à 6 caractères) : récupérer son nom et ses rooms | `/api/sync/pair`, `/api/sync/` |
| Présence « people here » : liste par pays et carte 2D | `/presence`, `/api/here/*` |

**Jalon M3 : économie et extras**

| Fonctionnalité | Source |
|---|---|
| Fenêtre BUBBLE : comment en gagner, solde, holders, transfert | `/api/bubble`, `/api/bubble/holders`, `/api/bubble/boop`, realm `bubble` |
| Graphe de parrainage | `/api/refs`, `/api/refs/claims`, `/api/ref` |
| wBUBBLE : Wrap (Approve + Wrap) et Unwrap | realms `bubble`, `wbubble` |
| « In play » : positions et historique | `/api/holdings/history` |
| Prix GNOT | `/api/price`, `/api/prices` |
| News (lecture, votes), papers | `/api/news`, `/api/news/vote`, `/api/papers` |
| KBW 2026, world time | `/kbw.json`, local |
| Drapeaux par pool | `/api/flags`, `/api/flag` |

**Exclus :**

- les outils de l'opérateur (fenêtre ADMIN, `/api/admin/*`, suggestions, jeton
  propriétaire `/owner`, épinglage) ;
- l'analytique `/api/sight` (rien n'est envoyé par défaut) ;
- les notifications push ;
- le globe 3D, remplacé par une carte 2D.

### 5.5 Identité off-chain

Le serveur identifie le client par des secrets locaux, pas par le wallet :

- un identifiant aléatoire de 16 hex (`X-Bid`) ;
- une clé de nom réservé de 64 hex (`X-Name-Key`) ;
- l'avatar (`X-Av`, `X-Av-Key`).

La dapp les génère et les garde dans SecureStore. L'appairage par code permet de
reprendre ceux du navigateur. Les endpoints et en-têtes sont ceux du site ; en
cas de divergence, c'est le comportement du site qui fait foi.

> **Risque connu :** l'API est privée et non documentée, et l'opérateur peut la
> modifier. Le client off-chain est isolé (`src/offchain/`), typé et tolérant
> aux champs inconnus. Une erreur réseau n'empêche jamais de jouer.

### 5.6 Gestion des erreurs

- **Les rejets de la chaîne** sont classés par gnonative (codes typés) puis
  traduits en messages et en actions (5.3).
- **Le off-chain** se dégrade proprement : un indicateur « serveur
  injoignable » apparaît et le jeu continue.
- **GnoConnect :**
  - `state` est vérifié, et toute réponse qui ne correspond à aucune requête en
    cours est ignorée ;
  - un callback n'est jamais pris pour une preuve : on vérifie toujours sur la
    chaîne ;
  - une réponse `connect` n'accorde une session que si son champ `session` est
    l'adresse de la clé de la dapp ; sinon c'est une réponse d'identité seule,
    qui mène au repli avec l'adresse maître déjà connue ;
  - une requête sans réponse au bout d'un délai mène au repli.

### 5.7 Tests

- **Unitaires** (jest) : payload de preuve, construction des liens GnoConnect,
  parsing des callbacks, calculs (prix `base·√N`, horloge, cote du shot, budget
  restant), parseurs JSON du realm et du serveur.
- **Intégration** sur gnodev (script) : `bubblerumble5` chargé ; création de
  session par repli ; `CreatePool`, `Bid`, `Claim`, `Withdraw` en session ;
  renouvellement (commandes équivalentes à `connect` avec `old`), puis
  révocation (équivalent de `disconnect`).
- **Off-chain :** tests du client sur des réponses enregistrées du serveur
  officiel, en lecture seule. Aucun POST vers le serveur de production dans les
  tests automatiques.
- **Manuel :** simulateur iOS et émulateur Android, aller-retour réel avec
  gnokey-mobile (P2).

## 6. Décisions et hypothèses

- gnokey-mobile garde son modèle sans clé maître (option a).
- Le paramètre `rpc` du site (proxy `/rpc` de bubblerumble.net) n'est pas
  utilisé : la dapp parle directement au RPC configuré.
- Store de l'état : zustand, sauf contre-indication pendant le plan.
- Aucun envoi de données d'analytique.
- Sessions côté standard (révision du 2026-10-01) : la dapp ne connaît que
  `connect` et `disconnect`. Elle passe sa clé publique dans `connect` pour une
  session qu'elle détient ; le renouvellement est un `connect` avec une
  nouvelle clé et `old`, en une seule transaction, plutôt que `disconnect` puis
  `connect` (deux passages au desktop avec gnokey-mobile). Les sessions du
  wallet restent son affaire, la dapp peut toujours utiliser `sendtx` avec la
  même identité.

## 7. Ordre de réalisation

1. P1 (`SignBytes`).
2. P3-M1 avec le repli desktop : la boucle de jeu complète en session.
3. P2 (`connect` avec clé et `disconnect` dans gnokey-mobile), puis
   vérification de l'aller-retour avec P3. P3-M1 envoie déjà ces requêtes et
   traite leurs réponses ; il ne reste à y faire que les corrections que
   l'aller-retour révélera.
4. P3-M2 (social).
5. P3-M3 (économie et extras).
6. **Mise à jour du standard GnoConnect,** une fois l'aller-retour P2 ↔ P3
   vérifié de bout en bout. Le contenu de `gnoconnect-session.md`, corrigé de
   ce que l'implémentation aura appris, est intégré dans
   `docs/resources/gnoconnect.md` :
   - de préférence dans `~/gno-external-wallets`
     (`feat/gnoconnect-external-wallets`, PR #5970), puisque `connect` et
     `disconnect` y sont définis comme launch links ;
   - puis repris dans `~/gno-inpage-wallets`, qui est basé dessus ;
   - à défaut, directement dans `~/gno-inpage-wallets`, à décider à ce
     moment-là selon l'état des deux branches.

   Cette étape étend la section `connect` existante, ajoute le host
   `disconnect` et le token `sessions` dans les `features` de `connect`, et met
   à jour « Known Implementations ».

Chaque étape fait l'objet d'un plan d'implémentation séparé.

## 8. Branches

| Dépôt | Branche | Base |
|---|---|---|
| `~/gnonative` | `feat/sign-bytes` | `origin/main` (indépendante de `feat/errdetails-everywhere`) |
| `~/gnokey-mobile` | `feat/session-hosts` | `feat/deeplink-tx` (infrastructure GnoConnect) |
| `~/bubblerumble` | `main` | nouveau dépôt |
| `~/gno-external-wallets` ou `~/gno-inpage-wallets` | branche existante | étape 6 |

## 9. Suivi : ce qui reste à faire

État au 2026-10-03. À mettre à jour à chaque étape livrée.

**Livré :**

- P1 (`SignBytes` dans gnonative) : branche `feat/sign-bytes`, rebasée sur `gnolang/gnonative`
  main, PR https://github.com/gnolang/gnonative/pull/233. L'archive locale
  `~/gnonative/expo/gnolang-gnonative-0.1.2.tgz` (construite avant le rebase) sert à P3-M1.

- P3-M1 (session + boucle de jeu) : 17 tâches sur `main` (`8ca8ed3`..`85ef882`), revue de chaque
  tâche puis revue finale de la branche ; 147 tests unitaires, 5 tests de bout en bout sur gnodev.
  Ledger (non versionné) : `.superpowers/sdd/2026-10-01-p3-m1-game-loop/progress.md`.

- P2-M1 (`core/` + pont `mobile/` de gnokey-mobile) : 12 tâches sur `feat/deeplink-tx`
  (`767f432`..`cb83a36`, poussé sur la PR #138 le 2026-10-03), exécution inline puis revue finale de la branche, correctifs
  `b546701` (le pont revérifie la preuve du lien que lui rend le natif ; `PollSessionOutcome` refuse
  une autre chaîne ; nom de paramètre contenant `=` refusé — règle ajoutée à
  `gnoconnect-session.md` ; une session sans `spend` ne couvre aucune indication). Tests unitaires
  Go + 2 tests d'intégration sur gnodev (`npm run gnodev`), dont un qui passe les commandes générées
  dans un vrai `gnokey` ; `make build.android` exporte la surface.

- P2-M1b (les mineurs reportés de P2-M1) : 6 tâches sur `feat/deeplink-tx` (`a5f0d0d`..`d241eef`,
  non poussé), plan `docs/superpowers/plans/2026-10-03-p2-m1b-session-minors.md`, revue finale
  « prêt » sans Critical ni Important. Expiration et `ExpiresAt` jugés au temps de la chaîne
  (`min(horloge du téléphone, heure du dernier bloc)`) ; pin `signer` comparé comme adresse ; clé de
  session déjà compte ordinaire refusée d'emblée (`invalid_request`) ; lien refusé puis relivré
  répondu une seule fois ; `make test.integration` vert (l'ancien test `r/demo/counter` est sauté
  sans son realm). **Contrat natif** (P2-M2/M3) — trois codes internes jamais répondus au
  producteur : `replayed` (ignorer la copie), `already_done` (le résultat est déjà sur la chaîne :
  continuer à interroger, le prochain `PollSessionOutcome` dit Done), `wrong_network` (résoudre le
  réseau — basculer, ou répondre `network_declined` — puis rappeler). Mineurs restants, à régler
  avant ou pendant P2-M2/M3 : `chainNow` sur une chaîne sans blocs vides ou un nœud en retard
  (durée comptée depuis le dernier bloc — notre `npm run gnodev` a `-empty-blocks`, donc non
  concerné) ; nœud à la hauteur 0 qui rapporte l'époque Unix ; `already_done` d'un `disconnect`
  sûr seulement si le natif appelle `PlanSessionRequest` avant `BuildSessionTx` (à écrire dans la
  doc du pont) ; mémoire des liens non bornée.

**À faire avant d'utiliser l'app sur mainnet :** rien.

**Réglé le 2026-10-02 :**

- **Licence** : Apache 2.0, comme gnokey-mobile (`LICENSE` copié de gnokey-mobile, `"license"` dans
  `package.json`), à la place du MIT du template Expo.

- **Vérification manuelle sur émulateur Android 17** (`Medium_Phone`, `adb reverse` 26657/8081), même
  liste que sur iOS : pools mainnet puis gnodev, icônes Material des onglets, demande de session
  (gnokey-mobile propose de passer de `10.0.2.2` à `127.0.0.1` — même chaîne `dev` —, `connect`
  d'identité seule → commande desktop), session détectée sur la chaîne, kill/relance (session
  reprise), création de pool, boops, budget épuisé (« Session budget used up — it refills in … »).
  Aucun bug propre à Android. Trouvé en chemin, valable aussi sur iOS : la liste des pools ne se
  rechargeait qu'au tick de 15 s, un pool créé n'apparaissait pas au retour (`d966e81`, rechargement
  au focus).

- **Correctifs iOS de gnonative**, ajoutés à la PR #233 (`78531cc`, `f516370`) : registre des
  promesses protégé contre les accès concurrents (crash dans `PromiseBlock.remove()`), fin de flux
  `EOF` reconnue sur iOS (toute transaction réussie était affichée en échec).

- **Vérification manuelle sur simulateur iOS 26.5** (idb-companion 1.6.4), contre gnodev ligne
  mainnet et la vraie archive : liste des pools mainnet, passage sur gnodev sans relance, demande de
  session (gnokey-mobile en `connect` d'identité seule → commande desktop avec l'adresse connue ;
  gnokey-mobile sans compte → `no_signer` → commande desktop), détection de la session sur la chaîne,
  survie d'une demande en cours à un kill de l'app, création de pool, boop (« you are on top »),
  budget de session épuisé refusé avec un message clair, budget restant et gains à jour. Corrigé en
  route dans l'app : `no_signer` sans issue (`ef7f893`), drapeau proposé deux fois (`c108cf5`).

- **gnonative et `bank.TransferEvent`** : gno passé sur la ligne `chain/mainnet` (`5cdbc25fc`) dans
  la PR #233 (`09ddd60`, avec `NewSnapshot` refusé par le DB natif) ; archive refaite et réinstallée
  dans l'app. Le test Go `TestDecodeBankTransferEvent` épingle le décodage.
- **Course au changement de réseau** : `src/state/network-sync.ts` (`2ab43eb`) ; le store de session
  et `GameClient` lisent le réseau sur lequel gnonative est réellement, mis à jour seulement après
  `setRemote` / `setChainID`.

**Suivis gnonative révélés par P3-M1 :**

- `getGrpcError` n'a pas de cas pour `std.SessionNotAllowedError` : le détail de la chaîne (« session
  spend limit exceeded … ») est perdu ; l'app classe donc tout refus de session comme un budget épuisé.

- `expo/src/index.ts:10` assigne `Symbol.asyncIterator`, en lecture seule sous Hermes avec Expo
  SDK 57 : l'import plante. La dapp le contourne avec `patch-package`
  (`patches/@gnolang+gnonative+0.1.2.patch`, voir `patches/README.md`) ; à corriger en amont
  (PR séparée), puis retirer le patch.
- Sur iOS, l'erreur de `SignBytes` arrive en `UnexpectedException` (le code `ErrNoActiveAccount`
  n'est que dans le message). L'archive refaite le 2026-10-02 depuis la branche rebasée contient
  gnolang/gnonative#232, qui devrait transmettre le code : à vérifier sur appareil.

**Révision du 2026-10-01 (sessions via `connect` / `disconnect`) :** appliquée à
`gnoconnect-session.md`, à cette spec et au plan P3-M1 (tâches 7, 9, 15, 16 et 17). Le plan P1
ne change pas, sauf la donnée de test de `SignBytes` qui prend le nouveau nom de host. L'ancien
point « adresse maître via `connect` dans le repli desktop » est absorbé dans P3-M1 : une
réponse `connect` sans session pour la clé de la dapp donne l'adresse maître et lance le repli.

**Sorti volontairement des plans actuels, à ne pas oublier :**

1. **Plans pas encore écrits,** à rédiger une fois l'étape précédente livrée, pour s'appuyer sur
   les vraies interfaces :
   - P2 : `connect` avec clé et `disconnect` dans gnokey-mobile (§4), puis vérification de
     l'aller-retour avec P3. Découpé en jalons : P2-M1, `core/` et pont `mobile/`, plan
     `docs/superpowers/plans/2026-10-02-p2-m1-gnokey-core-sessions.md`, sur la branche
     `feat/deeplink-tx` (PR #138), gno passé sur la ligne `chain/mainnet` (`5cdbc25fc`) comme
     gnonative — **livré le 2026-10-03** (voir Livré) ; P2-M2 (iOS) et P2-M3 (Android), à écrire
     maintenant, à partir du pont tel qu'il est ;
   - P3-M2 : social, off-chain (§5.4) ;
   - P3-M3 : économie et extras (§5.4) ;
   - mise à jour du standard GnoConnect dans `~/gno-external-wallets` ou `~/gno-inpage-wallets`
     (§7, étape 6).
2. **Indications de périmètre** (`connect` sans `pubkey`, §4) : retenues dans P2 (tâche 11 de
   P2-M1, livrée ; écran dans P2-M2/M3). Bubble Rumble ne s'en sert pas.
3. **Écarts entre le plan P3-M1 et cette spec,** non implémentés : délai sans réponse du wallet qui
   mène au repli (§5.6 ; le bouton « Use a computer instead » le remplace), indicateur « serveur
   injoignable » (§5.6), sessions conservées par réseau (une seule session active aujourd'hui).
4. **Mineurs vus sur simulateur :** le bouton retour de l'écran d'un pool affiche « (tabs) » ; le
   preset réseau choisi n'est pas mis en évidence ; sur le runtime
   iOS 26.2, UIKit tue l'app au rendu du clavier logiciel (environnement, pas l'app).
