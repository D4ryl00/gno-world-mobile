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
| Realm | `…/bubblerumble6` (+ v1–v5 pour les anciens pools ; le site est passé à v6 le 2026-10-03) | non |
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
- **Entrées autorisées** (8 sur 8) : `vm/exec:` pour bubblerumble6, 5, 4, 3, 2
  et 1, `bubble` et `wbubble`. Une session accordée avant v6 n'a pas v6 : l'écran Session
  propose de la renouveler, et un refus de la chaîne sur v6 le dit.
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
| Anciens pools v1–v5 : lecture, Claim et Withdraw (Withdraw n'existe qu'à partir de v3) | realms v1–v5 |
| Présence : battement toutes les 20 s pendant que l'app est au premier plan ; il renvoie le pays du client | `POST /presence?id=<pid>` (`X-Bid`) |
| **Blocage US**, comme le site : si le pays renvoyé est `US`, boop, création et shots sont désactivés avec le texte du site (« Due to US regulations, play is not offered to visitors from the United States. »). Claim et Withdraw restent possibles, comme sur le site. Si le serveur est injoignable, le jeu reste ouvert, comme sur le site | `/presence` |
| Liens de partage au format du site (`https://bubblerumble.net/?ref=<addr>#v5-12`), lisibles par le web | — |

**Jalon M2 : social (off-chain)**

| Fonctionnalité | Endpoints |
|---|---|
| Chat principal : lire, poster, répondre, éditer, supprimer, réactions, votes, épingles (lecture), signalement, « en train d'écrire » | `/api/chat` (GET/POST/PATCH/DELETE), `/react`, `/vote`, `/report`, `/typing`, `/withdraw` |
| Pièces jointes : images et fichiers, messages vocaux (enregistrement, lecture, lecture auto en file) | `/api/chat/file`, `/api/chat/clip` |
| Nom réservé, profil, avatar (le « profil » = nom + avatar ; `/api/profile` est un rapport de performance du site, pas un profil — corrigé par la spec M2a) | `/api/name`, `/api/avatar` |
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
- **Intégration** sur gnodev (script) : `bubblerumble6` chargé ; création de
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

État au 2026-10-12. À mettre à jour à chaque étape livrée.

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
  poussé sur la PR #138), plan `docs/superpowers/plans/2026-10-03-p2-m1b-session-minors.md`, revue finale
  « prêt » sans Critical ni Important. Expiration et `ExpiresAt` jugés au temps de la chaîne
  (`min(horloge du téléphone, heure du dernier bloc)`) ; pin `signer` comparé comme adresse ; clé de
  session déjà compte ordinaire refusée d'emblée (`invalid_request`) ; lien refusé puis relivré
  répondu une seule fois ; `make test.integration` vert (l'ancien test `r/demo/counter` est sauté
  sans son realm). **Contrat natif** (P2-M2/M3) — trois codes internes jamais répondus au
  producteur : `replayed` (ignorer la copie), `already_done` (le résultat est déjà sur la chaîne :
  continuer à interroger, le prochain `PollSessionOutcome` dit Done), `wrong_network` (résoudre le
  réseau — basculer, ou répondre `network_declined` — puis rappeler). Les 4 mineurs de sa revue
  finale réglés ensuite (`4f71c2e`..`a8ce2d9`) : pas d'heure de chaîne d'un nœud sans bloc (époque
  Unix à la hauteur 0) ou encore en synchronisation ; session refusée si, comptée depuis le dernier
  bloc (chaîne sans blocs vides, nœud en retard), elle serait déjà finie à son arrivée ; mémoire des
  liens bornée à 1024 ; doc du pont : `BuildSessionTx` seulement après un `PlanSessionRequest`
  réussi (c'est ce qui rend sûr `already_done` sur un `disconnect`). Plus rien de reporté dans P2-M1.

- P2-M2 (iOS de gnokey-mobile : `connect` avec clé, `disconnect`, indications de périmètre) : 9 tâches
  sur `feat/deeplink-tx` (`8b70461`..`2295ea1`, poussé sur la PR #138 le 2026-10-03), plan
  `docs/superpowers/plans/2026-10-03-p2-m2-gnokey-ios-sessions.md`, 42 tests XCTest
  (`make test.ios device=<udid>`, nouvelle cible). Aller-retour manuel Bubble Rumble ↔ gnokey-mobile
  sur simulateur iOS 26.5 contre gnodev, les 9 étapes conformes après deux correctifs :
  - `63b95f6` : gomobile déclare le champ Go `URL` comme propriété `url` mais nomme son setter
    `setURL:` ; le `.url = …` de Swift écrivait un ivar Objective-C et Go recevait `""` — toute
    demande de session était répondue `invalid_request`. Nouveau constructeur
    `mobile.NewSessionRequest(link)` (seul `SessionRequest.url`/`rpc` touché, vérifié par `nm`).
  - `2295ea1` : une session créée pour exactement l'`expires` indiqué ne le « couvrait » jamais
    (`ExpiresAt ≥ maintenant + expires`) ; l'`expires` d'un `connect` compte désormais depuis
    l'arrivée de la demande (moins une minute de marge). À reprendre tel quel dans P2-M3.
  Ses 4 mineurs reportés sont réglés (voir « Mineurs restants », ci-dessous).
  Ledger (non versionné) : `~/gnokey-mobile/.superpowers/sdd/2026-10-03-p2-m2-gnokey-ios-sessions/progress.md`.

- P2-M3 (Android de gnokey-mobile : `connect` avec clé, `disconnect`, indications de périmètre) : 9 tâches
  sur `feat/deeplink-tx` (`96c47c1`..`ef7deda`, poussé sur la PR #138 le 2026-10-03), plan
  `docs/superpowers/plans/2026-10-03-p2-m3-gnokey-android-sessions.md`, 25 tests JUnit sur la JVM
  (`make test.android`, nouvelle cible). Même pont et mêmes choix d'écran que P2-M2 (revue en dialogue
  plein écran, retour = `cancelled`), avec en plus : un lien qui lance l'app à froid attend le pont
  (`CompletableDeferred`) au lieu d'être parqué, et les indications d'un `connect` ne sont plus perdues au
  démarrage à froid ; une durée indiquée égale à un préréglage sélectionne le préréglage (le mineur
  « 1 day » / « 24 hours » de P2-M2 évité) ; l'intent de lancement n'est relu ni après recréation de
  l'activité ni depuis les récents. Aller-retour manuel Bubble Rumble ↔ gnokey-mobile sur l'émulateur
  Android 17 (arm64) contre gnodev, les 9 étapes conformes après un correctif :
  - `ef7deda` : la surveillance de la chaîne tournait aussi en arrière-plan ; elle trouvait la
    transaction, effaçait la demande et ouvrait le callback, qu'Android bloque depuis une app en
    arrière-plan (`BAL_BLOCK`) — le producteur n'était jamais répondu. Elle ne tourne plus que l'app au
    premier plan (`repeatOnLifecycle(RESUMED)`) et regarde dès le retour, comme iOS qui suspend l'app.
  Ses 3 mineurs reportés sont réglés par P2-M3b (ci-dessous).
  Ledger (non versionné) : `~/gnokey-mobile/.superpowers/sdd/2026-10-03-p2-m3-gnokey-android-sessions/progress.md`.

- P2-M3b (les 3 mineurs reportés de P2-M3, sur iOS et Android, qui avaient la même forme) : 3 tâches
  sur `feat/deeplink-tx` (`19e7692`..`971dfe6`, poussé sur la PR #138 le 2026-10-04), plan
  `docs/superpowers/plans/2026-10-03-p2-m3b-network-and-draft-minors.md`, 43 tests XCTest, 26 JUnit :
  - refuser un changement de réseau ne répond `network_declined` qu'aux demandes (`connect`, session)
    qui nommaient une autre chaîne (`needsSwitch`, testé sur les deux plateformes) ; une demande sur la
    chaîne courante, ou sans chaîne, reste en attente ;
  - après « Switch », la revue de session et le consentement `connect` attendent que le changement de
    réseau soit appliqué (`switchingNetwork`) : plus de `wrong_network` au premier plan ;
  - « Create a session for this app » garde le brouillon de l'utilisateur de côté : c'est lui qui est
    enregistré, et il revient à la fin de la construction (Back ou session arrivée).
  Vérifié à la main sur simulateur iOS 26.5 et émulateur Android 17 contre gnodev, Bubble Rumble comme
  producteur. Revue finale : relecture par l'auteur (pas de sous-agent), sans Critical ni Important.
  Son mineur reporté est réglé (voir « Mineurs restants », ci-dessous).
  Ledger (non versionné) : `~/gnokey-mobile/.superpowers/sdd/2026-10-03-p2-m3b-network-and-draft-minors/progress.md`.

- Mineurs restants (P2-M2, P2-M3b, Bubble Rumble), plan `docs/superpowers/plans/2026-10-04-remaining-minors.md`.
  gnokey-mobile, `feat/deeplink-tx` (`8cd1875`..`52003b2`, poussé sur la PR #138 le 2026-10-04), 46 tests
  XCTest, 26 JUnit :
  - iOS : une durée indiquée égale à un préréglage sélectionne le préréglage (plus de « 1 day » à côté
    de « 24 hours ») ; les réponses ne percent-encodent que ce que RFC 3986 réserve (`invalid_request`,
    `expires_at` lisibles) ; le coût du handoff affiche « (2000000 gas) » sans groupement selon la
    locale ; le solde maître est relu une fois une demande de session répondue (comme Android) ;
  - iOS et Android : une revue de session dont le wallet a quitté la chaîne (le changement de réseau
    d'un autre lien) affiche, au lieu de `wrong_network` et d'un « Try again » sans issue, la chaîne et
    l'endpoint demandés avec « Switch to chain … » (bascule puis replanifie) ou « Decline »
    (`network_declined`) — le contrat natif appliqué dans la revue même. L'invite de la racine avait été
    essayée d'abord : SwiftUI perd une alerte levée pendant que la feuille de revue est à l'écran.
    Trouvé en route sur Android : la carte et le bouton d'approbation lançaient sur leur propre scope,
    annulé par le rechargement du plan (affiché « rememberCoroutineScope left the composition ») ; ils
    utilisent celui de l'écran, et une annulation n'est plus affichée comme une erreur.
  Bubble Rumble, `main` (`4cdca67`, `beff113`) : le préréglage réseau correspondant aux champs est mis
  en évidence (`matchingPreset`, testé ; `accessibilityState.selected`) ; le bouton retour de l'écran
  d'un pool dit « Pools » au lieu de « (tabs) ». 163 tests jest, tsc et lint propres.
  Tout vérifié à la main sur simulateur iOS 26.5 (et Android 17 pour la revue) contre gnodev. Revue
  finale : relecture par l'auteur (pas de sous-agent).
  Ledger (non versionné) : `~/gnokey-mobile/.superpowers/sdd/2026-10-04-remaining-minors/progress.md`.

- Mineurs reportés de P3-M1 (les 46 du ledger P3-M1, jamais recopiés ici), plan
  `docs/superpowers/plans/2026-10-04-p3-m1-old-minors.md`, 14 tâches sur `main` (`6bcd17b`..`ffe2548`,
  2026-10-04) ; 218 tests unitaires, e2e 5/5 sur gnodev, tsc et lint propres. Les plus lourds :
  - la commande desktop payait `-gas-fee 1000000ugnot` (1 GNOT par opération de session, 500× le
    minimum mainnet de 1 ugnot / 1000 gas) : `10000ugnot` par défaut, réglable ;
  - un boop n'est plus signé à un prix périmé : le pool est relu avant de signer (`checkFresh`) ;
  - une session d'un autre réseau ou un budget insuffisant se voient avant d'appuyer ;
  - les clés de session abandonnées (annulée, refusée, échouée), révoquées ou remplacées sont
    supprimées du keybase ; une réponse du wallet pour un autre compte ou une autre chaîne est une
    erreur ; « Cancel » annule aussi une demande en préparation ; un stockage illisible ne bloque plus
    `restore()` / `onReply()` ; un renouvellement dont l'ancienne session reste sur la chaîne le dit,
    avec la commande pour la révoquer ;
  - liens GnoConnect : ordre canonique par point de code, contrôles C1 et `=` refusés, réponse lue là
    où le wallet l'écrit, limites du protocole appliquées à la construction ;
  - et les petits : `clockFor` sans montant, seuil de partage nommé, montants au-delà de 2^53 refusés,
    `\U` impossible refusé, pool sans id ignoré, texte de realm prioritaire sur un mot réseau, flux de
    transaction vide = issue inconnue, `setNetwork` gardé, horloge partagée pour les comptes à rebours,
    états vides / chargement / échec dits, création qui atterrit sur le nouveau pool, jours stricts et
    renouvellement depuis la session courante, révocation confirmée, harnais e2e (verrou, ports, trap
    qui ne tue plus le `gnodev` de `npm run gnodev`).
  Décisions sans changement de code (tableau « Triage » du plan) : archive gnonative hors du dépôt
  (jusqu'à la publication de la PR #233), expériences `reactCompiler`/`typedRoutes` gardées, paliers de
  tir du site, regex « issue inconnue » (gnonative n'offre aucun signal fiable). Revue finale :
  relecture par l'auteur, un défaut Important corrigé (clé non supprimée si une demande annulée
  échouait ensuite). Mineur trouvé en route, réglé ensuite (`ac36a33`) : un appui sur un bouton pendant que
  le clavier était ouvert ne faisait que fermer le clavier, et sur iOS le contenu ne défilait pas au-dessus
  du clavier ; les écrans à champs partagent désormais un `Page` (`keyboardShouldPersistTaps="handled"`,
  insets du clavier, fermeture au glissé). Plus rien de reporté.
  Ledger (non versionné) : `.superpowers/sdd/2026-10-04-p3-m1-old-minors/progress.md`.

- Étape 6 du §7 (mise à jour du standard GnoConnect), plan
  `docs/superpowers/plans/2026-10-04-gnoconnect-standard-sessions.md` : `gnoconnect-session.md`
  intégré dans `docs/resources/gnoconnect.md` de `~/gno-external-wallets`
  (`feat/gnoconnect-external-wallets`, PR #5970, `ded071ad6`), section « Sessions: `connect` with a key,
  and `disconnect` » sous « Launch Links » ; tableau des hosts (`disconnect`), `connect` (indications,
  `pubkey`, token `sessions`, nouveaux codes), règles des callbacks (nouvelles clés, exception `allow`,
  noms décodés, où lire la réponse) et « Known Implementations » (Gnokey Mobile, Bubble Rumble mobile)
  mis à jour. Corrigé de ce que l'implémentation a appris : `chainid` reste requis sur tout `connect`
  (le brouillon disait « optionnel ») ; `-expires-at` de gnokey prend une durée ; l'expiration se juge
  au temps de la chaîne ; les durées indiquées comptent depuis l'arrivée de la demande ; refuser un
  changement de réseau ne répond qu'aux demandes qui le demandaient, et une demande dont le wallet a
  quitté la chaîne est résolue à nouveau ; callbacks ouverts au premier plan seulement (Android) ;
  frais payés en entier, donc tirés du prix du gas de la chaîne ; ordre canonique par point de code et
  contrôles C0/DEL/C1 précisés. Retirés : le tableau de vérification (resté dans le brouillon) et les
  questions de conception du wallet. `~/gno-inpage-wallets` rebasée dessus sans conflit (60 commits),
  plus un commit (`12c2561b5`) qui relie la section à « The `signer` pin » et dit ce qui manque au
  fournisseur in-page ; poussées avec ton accord (PR #6016 en push forcé). Le brouillon porte une bannière vers le standard.

- Sessions GnoConnect dans le navigateur (in-page), spec
  `docs/superpowers/specs/2026-10-04-gnoconnect-inpage-sessions-design.md`, plan
  `docs/superpowers/plans/2026-10-04-gnoconnect-inpage-sessions.md`, 10 tâches exécutées inline le
  2026-10-05 :
  - gnokey-mobile (`feat/deeplink-tx`, `dd1e8c4`) : un `disconnect` sans clé est répondu `success`
    (+ `state`) par un callback sûr, sans écran ni pont (le wallet ne garde rien par producteur) ;
    48 XCTest, JUnit verts. Le cœur Go n'est pas touché : il ne voit jamais ces liens.
  - Adena (`~/adena-wallet`, `feat/gnoconnect-in-page`, fork, `f7480afc`..`e34254b8`) :
    `connect(opts)` et `disconnect(req?)` in-page, même objet signé que les liens (payload sans ligne
    `callback`, champs inconnus signés), preuves Ed25519 (WebCrypto) et secp256k1 (`elliptic`),
    contrôles avant toute fenêtre (CHECK puis CONNECT dans le service worker), clés de session
    `/tm.PubKeyEd25519`, fenêtre de revue (origine, réseau, identité, entrées risquées, budget et pire
    cas, expiration, ancienne / nouvelle clé, frais) ; 789 tests jest, build OK.
  - Bubble Rumble (`main`, `3af70c2`..`2373176`) : `prototypes/inpage-sessions/` — bibliothèque de
    requête (vecteurs Go, 12 tests Node), page de test (clé Ed25519 WebCrypto non exportable dans
    IndexedDB, ou secp256k1), banc Playwright + Chromium qui embarque Adena compilé, l'installe avec
    `test1` et rejoue les 7 scénarios du §6 pour les deux types de clé contre gnodev : 15/15. Une session
    Ed25519 créée par Adena est bien sur la chaîne en `/tm.PubKeyEd25519` à l'adresse que calcule la page,
    renouvelée puis révoquée.
  - Standard : `~/gno-external-wallets` `d51d5d9af` (`disconnect` sans clé, PR #5970) ;
    `~/gno-inpage-wallets` rebasée dessus (61 commits inchangés ; sauvegarde
    `backup/inpage-before-inpage-sessions`) + `8158ab13c` (« Sessions in the browser », Ed25519 MUST
    pour un wallet in-page, clé WebCrypto non exportable conseillée, Adena dans « Known
    Implementations »).
  Trouvés par le banc : Chromium headless refuse les fenêtres d'Adena (left 800 / top 300) hors de son
  écran virtuel (`--screen-info`) ; le stockage du service worker d'Adena garde tout le magasin en
  mémoire après sa première écriture, donc le retrait d'approbation passe par un stockage jetable
  (`e34254b8`). Revue finale : relecture par l'auteur (pas de sous-agent), sans Critical ni Important ;
  3 mineurs reportés dans le ledger, corrigés le 2026-10-05 (Adena `3c9d307f`..`bd396e6e`, banc
  `prototypes/inpage-sessions/bench`) : une revue fermée après l'envoi de sa transaction n'est plus un refus,
  le service worker relit la chaîne comme la revue l'aurait fait (`readBack`, partagé ; une lecture en
  échec ne passe plus pour une révocation) ; les marques anti-rejeu vivent dans `chrome.storage.local` ;
  défauts préexistants d'Adena : le stockage relit le magasin à chaque écriture (plus de cache, donc
  plus de stockage jetable), `createPopup` répond `UNEXPECTED_ERROR` si Chrome refuse la fenêtre, et
  l'origine d'une requête de page vient de `sender.url`, plus de ce que la page écrit. 811 tests jest,
  banc 19/19 (5b, 5c : revue fermée après l'envoi). Poussé le 2026-10-05 : #138 (`dd1e8c4`),
  #5970 (`d51d5d9af`), #6016 (`8158ab13c`, push forcé), fork Adena (`bd396e6e`). Ledger (non
  versionné) : `.superpowers/sdd/2026-10-04-gnoconnect-inpage-sessions/progress.md`.

- Passage à `bubblerumble6` (le site y est passé le 2026-10-03 à 02:02 UTC ; v6 = v5 sans dernier
  jour : un pool vit tant qu'on le boope, `CreatePool` perd `life`). v6 est le realm courant
  (`CURRENT_VERSION`), v5 rejoint les anciens ; création sans « Life » ; entrées autorisées 8 sur 8 ;
  `devchain/` inclut v6, e2e sur v6 (5/5). Trouvé sur simulateur : gnonative ne transmet que
  « session not allowed error », lu jusque-là comme un budget épuisé ; `GameClient` relit la session
  sur la chaîne et répond `not-allowed` (« renew it ») quand elle ne couvre pas le realm. Vérifié sur
  le simulateur iOS : pools v6 de mainnet, formulaire sans « Life », avertissement sur une session
  sans v6, refus expliqué, renouvellement via gnokey-mobile puis création d'un pool v6. Les pools v5
  restent listés et boopables tant qu'ils vivent, comme v1–v4 (le site masque ceux qui n'ont pas été
  joués avant le passage).

- P3-M2a (chat principal, nom, avatar) : spec `docs/superpowers/specs/2026-10-05-p3-m2a-chat-design.md`,
  plan `docs/superpowers/plans/2026-10-05-p3-m2a-chat.md`, 12 tâches inline sur `main`
  (`0a0614c`..`ab18085`, puis revue finale `d7408e6`..`c121360`). Onglet Chat (4ᵉ onglet) : lignes en direct par long-polling tant que l'app est
  au premier plan (store zustand), épingles, bot, sondages, réactions (7), répondre, éditer (15 min),
  reprendre sa dernière ligne, « en train d'écrire », pastille de non-lus (dernière ligne vue gardée
  par serveur), pages anciennes ; nom libre ou réservé (rapport de boop puis `POST /api/name`, comme
  le site), avatar depuis la photothèque (`expo-image-picker`, recadrage carré) ; pièces jointes et
  vocaux en texte (« 📎 picture », « 🎤 voice message »). Faux serveur `scripts/fake-offchain`
  (`npm run fake-offchain`) écrit d'après le JS du site. 306 tests jest, `npm run e2e:chat` 18/18
  (deux clients de l'app contre le faux serveur). Vérifié à la main : simulateur iOS 26.5 (toutes les
  étapes du plan, dont réservation refusée avant un boop puis acceptée après un boop sur gnodev, liée
  au compte qui a boopé, et serveur coupé → « server unreachable — retrying » sans gêner le jeu) ;
  production en lecture seule (25 présents, épingles, avatars, ✓, pages anciennes ; rien posté) ;
  émulateur Android (lecture, envoi, clavier). Écarts trouvés à la main, corrigés avec un test :
  `signalTyping` (nom en conflit avec la liste `typing`), dernière ligne vue par serveur, Blob envoyé
  avec le type demandé (`c687cd6`), feuille du nom au-dessus du clavier, et **Android** (`ab18085`) :
  avec edge-to-edge la fenêtre ne se redimensionne pas, le `KeyboardAvoidingView` du chat et de la
  feuille passe à `padding` sur Android aussi (un AVD avec `hw.keyboard=yes` fait flotter Gboard et
  cache le problème). Réservation réelle sur la production : **à faire par l'utilisateur** (le bot du
  site rappelle qu'il faut un boop récent, « in the last 3 minutes »). Revue finale (relecteur neuf,
  sans Critical) ; corrigés, chacun avec un test d'abord rouge : une réponse arrivée après un
  changement de serveur (page ancienne, envoi, édition, réaction, vote) n'entre plus dans la nouvelle
  vue (époque) ; le nom réservé, sa clé `X-Name-Key` et l'avatar sont rangés **par serveur** (la clé
  n'est plus envoyée à n'importe quel serveur des réglages ; le nom libre reste commun) ; le choix de
  photo ne demande plus l'accès aux photos (inutile en SDK 57) et un échec le dit sans bloquer la
  feuille ; l'historique remonté n'est plus rogné par le poll suivant ; « Répondre » pendant une
  édition quitte l'édition (avant : la réponse écrasait sa propre ligne). Les réponses long-poll de
  la production portent bien `pins`. Ses 13 mineurs reportés sont **réglés le 2026-10-05** (plan `docs/superpowers/plans/2026-10-05-p3-m2a-minors.md`, `12af22b`..`d0fd53e` puis le relevé ci-dessous) : un changement de gen oublie les lignes, réactions et votes de l'app et la marque « vu » porte sa gen ; seul l'arrière-plan arrête le chat, qui reprend à son curseur (le centre de notifications ne recharge plus) ; une erreur pour le champ, une pour la feuille ; ses réactions et votes gardés par serveur et par gen (comme `br.rx` du site, 400 lignes) et « qui a réagi » en appui long ; une édition inchangée n'envoie rien ; les lignes ne se redessinent plus à chaque poll ; Répondre/Éditer donnent le focus, « anon » proposé et la ligne retenue part une fois nommé ; libellé d'accessibilité « Chat, N unread » (celui du navigateur sinon) et menu d'une ligne en action d'accessibilité ; avatar envoyé en JPEG de 256 px (`expo-image-manipulator`, plus de `Response.blob()`) ; le faux serveur démarre chaque fois sur une nouvelle gen. 330 tests jest, `npm run e2e:chat` 19/19 ; vérifié sur le simulateur iOS et l'émulateur Android (clavier ancré). Revue finale (relecteur neuf) : un Important corrigé (`40a717c` : la ligne retenue partait dès le nom enregistré et croisait « Reserve this name » ; elle part désormais à la fermeture de la feuille), 5 mineurs reportés dans le ledger du plan (action « longpress » brute sous VoiceOver, libellé « reply, react, edit » trop large, erreur ancienne après une édition inchangée, nom `newest` masqué, entrées vides gardées). Ledger (non
  versionné) : `.superpowers/sdd/2026-10-05-p3-m2a-chat/progress.md`.

- Renommage en **gno.world** (2026-10-12) : le site est devenu https://gno.world (même serveur que
  bubblerumble.net, même build ; « Bubble Rumble » n'y apparaît plus). App « gno.world », slug
  `gno-world`, schéma `gno.world://` (rappel `gno.world://session-callback`), bundle id / package
  `world.gno.app` (nouvelle app : réglages, clé de session et nom réservé des installations existantes
  ne suivent pas), serveur hors chaîne par défaut `https://gno.world`, liens de partage au format du
  site `https://gno.world/#rumble/<pool>&ref=<adresse>` (sans `#rumble/`, gno.world cache les pools).
  Inchangés : les chemins des realms (`…/bubblerumble`..`bubblerumble6`), les clés de stockage
  (`br.*`), le dossier `~/bubblerumble`, les specs et plans datés.
- Réservation du nom 100 % mobile (2026-10-12/13) : spec
  `docs/superpowers/specs/2026-10-12-gnoconnect-challenge-design.md`, plan
  `docs/superpowers/plans/2026-10-12-gnoconnect-challenge.md`, exécuté en ligne. gno.world exige
  désormais une phrase signée (ou un boop de moins de 3 min), refuse une clé de session et ne
  réémet jamais la clé d'un nom. Livré : `gnokey sign-data` et `std.SignDataPayload` /
  `std.VerifySignData` (gno `feat/gnokey-sign-data`, `38723ce23`, poussé sur le fork) — il a
  réservé `remi` sur la production ; le standard GnoConnect gagne `challenge` sur `connect` (#5970
  `a5627a483`, #6016 rebasée + `cb66934bc`) ; gnokey-pair signe un texte (type `data`,
  `724f35fd9`, poussé) ; gnokey-mobile le lit, le fait signer sur l'ordinateur et vérifie la
  preuve (`feat/send-to-computer` `4633429..324a132`) ; l'app suit la séquence du site
  (`c9a7dcf..ab2efff`). Vérifié de bout en bout le 2026-10-13 sur simulateur iOS et émulateur
  Android (gnodev, faux serveur, relais local, gnokey-pair `-manual`), y compris le refus « this
  wallet holds the name … already » après la signature.

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
     gnonative — **livré le 2026-10-03** (voir Livré) ; P2-M2 (iOS) et P2-M3 (Android) **livrés le
     2026-10-03** (voir Livré) : P2 est complet sur les deux plateformes ;
   - P3-M2 : social, off-chain (§5.4), découpé le 2026-10-05 en quatre jalons, chacun avec sa spec
     et son plan : M2a chat principal (avec nom réservé, profil, avatar), M2b rooms, DM et amis,
     M2c pièces jointes et vocaux, M2d appairage avec le navigateur et présence « people here ».
     **M2a livré le 2026-10-05** (voir Livré) ; suivant : M2b.
     Vérification sur un faux serveur local écrit d'après le JS du site (pas de serveur de test
     public) ; la production n'est lue qu'en lecture seule, plus un passage manuel court dans une
     room privée ;
   - P3-M3 : économie et extras (§5.4) ;
   - mise à jour du standard GnoConnect dans `~/gno-external-wallets` ou `~/gno-inpage-wallets`
     (§7, étape 6) — **faite le 2026-10-04** (voir Livré).
2. **Indications de périmètre** (`connect` sans `pubkey`, §4) : retenues dans P2 (tâche 11 de
   P2-M1, livrée ; écran iOS dans P2-M2, livré ; Android dans P2-M3, livré). Bubble Rumble ne s'en sert pas.
3. **Écarts entre le plan P3-M1 et cette spec,** non implémentés : délai sans réponse du wallet qui
   mène au repli (§5.6 ; le bouton « Use a computer instead » le remplace), indicateur « serveur
   injoignable » (§5.6), sessions conservées par réseau (une seule session active aujourd'hui).
4. **Mineurs vus sur simulateur :** réglés le 2026-10-04 (voir Livré, « Mineurs restants »), sauf
   un problème d'environnement, pas de l'app : sur le runtime iOS 26.2, UIKit tue l'app au rendu du
   clavier logiciel.
5. **Clavier Android hors du chat (vu pendant P3-M2a) :** `Page` (formulaires de P3-M1 : nouveau pool,
   réglages, session) compte sur « Android redimensionne la fenêtre » et sur
   `automaticallyAdjustKeyboardInsets`, propre à iOS ; avec edge-to-edge la fenêtre garde sa taille.
   Vu clavier ancré sur l'émulateur (1080×2400, `hw.keyboard=no`) : les champs restent visibles, le
   bouton du nouveau pool aussi, mais le bouton Save des réglages passe sous le clavier (il faut le
   fermer d'abord) ; un petit écran cacherait davantage. **Essayé le 2026-10-05 puis retiré** : une
   place de la hauteur du clavier sous le contenu ne sert à rien, `Page` fermant le clavier au premier
   glissé (`on-drag`) — et ce glissé montre déjà le bouton, comme le faisait `adjustResize`. Reste
   ouvert : un champ bas sur un petit écran reste sous le clavier pendant la saisie ; le
   `KeyboardAvoidingView` de RN 0.86 mesure son cadre par rapport à son parent (`onLayout`), il lui
   faudrait `keyboardVerticalOffset` = la position de l'écran dans la fenêtre (sous un en-tête de pile).
6. **Réservation par le wallet (2026-10-13) :** à faire par l'utilisateur — réserver un nom libre
   sur la production depuis l'app, avec une identité qui n'a pas encore de nom (`remi` a déjà
   `remi`). Mineurs vus pendant l'essai : sur Android, au retour du wallet l'app revient sur le
   Chat avec la feuille du nom fermée (le résultat se lit dans l'en-tête ; un refus seulement en la
   rouvrant ; iOS la garde ouverte) ; la feuille « Prove your identity » du wallet montre l'état de
   sa propre session, sans rapport avec une preuve. Le relais public de gnokey-pair répondait 500
   le 2026-10-13.
