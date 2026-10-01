# Bubble Rumble mobile : design

- **Date :** 2026-10-01
- **Statut :** à relire
- **Référence protocole :** `gnoconnect-session.md` (hosts `createsession`,
  `replacesession`, `revokesession`), testé sur gnodev (gno `83e0a40ea`).

## 1. Objectif

Jouer à Bubble Rumble sur mobile (iOS et Android) avec les mêmes fonctionnalités
que bubblerumble.net, **hors notifications push**, sans repasser par un wallet à
chaque transaction.

La dapp détient sa propre clé de session. La session est accordée une fois par
l'identité de l'utilisateur via gnokey-mobile (hosts de session GnoConnect),
signée au desktop (option a), avec un budget horaire et une durée longue. Si
gnokey-mobile est absent ou ne connaît pas ces hosts, la dapp propose elle-même
la commande desktop (repli intégré).

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
| P2 | Hosts de session dans gnokey-mobile | `~/gnokey-mobile` | — |
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
- **Tests :** test Go du service (signature vérifiable par
  `PubKey.VerifyBytes`, adresse inconnue → erreur typée), régénération
  `buf`/proto, build du module.
- **Hors périmètre :** toute autre évolution de gnonative.

## 4. P2 : gnokey-mobile, hosts de session

Implémentation de `gnoconnect-session.md` sur iOS et Android, avec la logique
dans `core/` (Go, partagé par les deux plateformes).

**`core/` (Go) :**

- **Parsing et validation** des trois hosts. Paramètres et bornes du spec : 8
  entrées maximum, `period` ≤ 30 j, `expires` ≤ ~4 ans, grammaire des allow
  entries.
- **Preuve de possession :** payload canonique, vérification `sig` / `oldsig`
  (secp256k1 et ed25519), fenêtre `iat`, mémoire anti-rejeu `(pubkey, state)`.
- **Pré-vérifications sur la chaîne :** session existante / introuvable, slot
  libre, sessions expirées révocables.
- **Construction des transactions :**
  - create : la commande `gnokey maketx session create …` ;
  - replace et nettoyage : le document de transaction multi-messages, plus la
    commande `gnokey sign -account-number -account-sequence … && gnokey
    broadcast -dry-run … && gnokey broadcast …` ;
  - revoke : la commande `gnokey maketx session revoke …`.
- **Détection de l'issue** par polling de
  `auth/accounts/{maître}/session/{adresse}` : présence (create, replace) ou
  absence (revoke). Le document est régénéré si la séquence du maître bouge.
- **Construction du callback** : `address`, `session`, `expires_at`, `allow`,
  `spend`, `period`, `chainid`, `hash` (optionnel), `state` ; codes d'erreur du
  spec.
- **Pont `mobile/`** : fonctions typées, comme l'existant.

**iOS et Android :**

- Routage des hosts dans `DeepLink.swift` / `DeepLink.kt` et `AppModel` /
  `AppViewModel`. `unsupported_host` reste la réponse aux hosts inconnus.
- **Écran de consentement** selon la section Review du spec :
  - hôte du callback, réseau (chain id + endpoint), identité ;
  - entrées autorisées, avec avertissement sur `*`, `vm/exec` nu, `vm/run` et
    `bank/*` ;
  - budget en clair et pire cas sur toute la durée, date d'expiration ;
  - pour un remplacement, la comparaison ancien / nouveau ;
  - la possibilité de **restreindre** la demande (durée, budget, période,
    entrées), jamais de l'élargir.
- **Écran de passage au desktop** : réutilise `HandoffScreen` / `CommandBlock`
  (commande + QR). Il affiche l'attente sur la chaîne, propose l'annulation
  (→ `cancelled`) et garde la requête en attente si l'app passe en arrière-plan.
- **Sessions expirées** : proposition d'ajouter leur révocation dans la même
  transaction, visible dans la revue.
- **`connect`** : ajout de `createsession`, `replacesession` et `revokesession`
  dans `features`.

**Tests :**

- tests unitaires Go (payload, preuve, validation, construction des documents,
  callbacks) ;
- test d'intégration Go sur gnodev (create, replace, revoke, nettoyage, rejets) ;
- tests du parseur côté Swift et Kotlin (le `DeepLinkTest.kt` existant sert de
  modèle).

## 5. P3 : dapp Bubble Rumble

### 5.1 Stack et structure

- **Framework :** Expo (SDK de boards2-mobile, 54) + expo-router + TypeScript.
- **gnonative :** dépendance locale (`file:../gnonative/expo`) tant que
  `SignBytes` n'est pas publié.
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
  3. Elle lance `createsession` vers gnokey-mobile, avec la preuve de
     possession via `SignBytes`.
- **Entrées autorisées** (7 sur 8) : `vm/exec:` pour bubblerumble5, 4, 3, 2 et
  1, `bubble` et `wbubble`.
- **Repli** si l'app n'est pas installée, si la réponse est `unsupported_host`,
  ou en l'absence de réponse après un délai : la dapp affiche elle-même la
  commande `gnokey maketx session create …` et un QR. Elle demande l'adresse
  maître (saisie, collage ou `connect` si gnokey-mobile l'implémente), puis
  détecte la session par polling.
- **Après l'accord :** `ActivateAccount(clé, maître)`. La dapp vérifie sur la
  chaîne (`QuerySessionAccount`) l'expiration, le plafond, la période et les
  entrées autorisées.
- **Écran Session :**
  - budget restant (règle de remise à zéro), solde du maître, expiration ;
  - boutons « Renouveler / changer le budget » (`replacesession`, nouvelle
    clé), « Révoquer » (`revokesession`) et « Recharger » (QR de l'adresse
    maître) ;
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
| Anciens pools v1–v4 : lecture, Claim et Withdraw | realms v1–v4 |

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
  - une requête sans réponse au bout d'un délai mène au repli.

### 5.7 Tests

- **Unitaires** (jest) : payload de preuve, construction des liens GnoConnect,
  parsing des callbacks, calculs (prix `base·√N`, horloge, cote du shot, budget
  restant), parseurs JSON du realm et du serveur.
- **Intégration** sur gnodev (script) : `bubblerumble5` chargé ; création de
  session par repli ; `CreatePool`, `Bid`, `Claim`, `Withdraw` en session ;
  `replacesession`, puis `revokesession`.
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

## 7. Ordre de réalisation

1. P1 (`SignBytes`).
2. P3-M1 avec le repli desktop : la boucle de jeu complète en session.
3. P2 (hosts de session dans gnokey-mobile), puis branchement de la voie
   gnokey-mobile dans P3.
4. P3-M2 (social).
5. P3-M3 (économie et extras).
6. **Mise à jour du standard GnoConnect,** une fois l'aller-retour P2 ↔ P3
   vérifié de bout en bout. Le contenu de `gnoconnect-session.md`, corrigé de
   ce que l'implémentation aura appris, est intégré dans
   `docs/resources/gnoconnect.md` :
   - de préférence dans `~/gno-external-wallets`
     (`feat/gnoconnect-external-wallets`, PR #5970), puisque les hosts de
     session sont des launch links ;
   - puis repris dans `~/gno-inpage-wallets`, qui est basé dessus ;
   - à défaut, directement dans `~/gno-inpage-wallets`, à décider à ce
     moment-là selon l'état des deux branches.

   Cette étape ajoute aussi les hosts à « Known Implementations » et à la liste
   des `features` de `connect`.

Chaque étape fait l'objet d'un plan d'implémentation séparé.

## 8. Branches

| Dépôt | Branche | Base |
|---|---|---|
| `~/gnonative` | `feat/sign-bytes` | `origin/main` (indépendante de `feat/errdetails-everywhere`) |
| `~/gnokey-mobile` | `feat/session-hosts` | `feat/deeplink-tx` (infrastructure GnoConnect) |
| `~/bubblerumble` | `main` | nouveau dépôt |
| `~/gno-external-wallets` ou `~/gno-inpage-wallets` | branche existante | étape 6 |
