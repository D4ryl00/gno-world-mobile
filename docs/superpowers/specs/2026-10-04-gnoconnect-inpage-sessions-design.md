# GnoConnect — sessions dans le navigateur (in-page) : design

Date : 2026-10-04. Suite de l'étape 6 du §7 de `2026-10-01-bubblerumble-mobile-design.md` (sessions
intégrées au standard pour les launch links, PR #5970 / #6016).

## 1. Intention

**Objectif (dit par l'utilisateur).** Que les dapps et wallets du navigateur puissent faire ce que
font ceux du mobile, autant que possible ; en particulier qu'une dapp web génère sa propre clé de
session et la fasse activer par le wallet (Adena).

**Critère de succès.** Une dapp web obtient, renouvelle et révoque sa session auprès d'un wallet
in-page avec les mêmes garanties que sur mobile — preuve de possession, rétrécir sans jamais
élargir, confirmation sur la chaîne — par les **mêmes verbes, le même objet signé et les mêmes
règles** que les launch links. Vérifié par un prototype dans Adena et une page de test, sur gnodev.

**Préférence retenue (2026-10-04).** Parité des transports d'abord : toute différence entre launch
links et in-page doit venir d'une raison concrète du transport (coût d'un aller-retour,
authentification de l'appelant, état existant), pas d'une préférence d'API.

## 2. Décisions

1. **Verbes identiques.** In-page : `connect(opts)` porte les mêmes champs que le lien `connect`
   (indications de périmètre, ou `pubkey` avec sa demande et ses preuves) ; `disconnect(req?)`
   reprend le host `disconnect`. Pas de méthode dédiée (`requestSession`), pas de `sendMsgs` avec
   des messages `auth`.
2. **`disconnect` termine ce qui existe**, sur les deux transports :
   - toujours, ce que le wallet garde pour la dapp — in-page, l'approbation de l'origine (puis
     l'événement `disconnect`, même sens) ; sur un lien, rien aujourd'hui ;
   - si la requête nomme une clé avec sa preuve, la session tenue par la dapp, révoquée sur la
     chaîne dans le même appel.
   `pubkey` devient donc **optionnel aussi sur le host `disconnect`** (changement de #5970 et de
   gnokey-mobile). Sans clé, la requête n'est pas authentifiée (sur un lien l'hôte du callback est
   auto-déclaré) : elle ne peut que retirer, et le wallet demande à l'utilisateur avant toute
   révocation sur la chaîne.
3. **Même preuve, même payload** (`gnoconnect-session-v1`, `host=connect` / `host=disconnect`,
   lignes triées par point de code), construit à partir des champs. In-page, **pas de ligne
   `callback`** : la réponse revient à la page appelante et ne peut pas être redirigée.
4. **Clés.** Un wallet in-page qui accorde des sessions DOIT accepter **Ed25519 et secp256k1**
   (preuve et clé de session). Une dapp web DEVRAIT utiliser une clé **Ed25519 WebCrypto non
   exportable** (`extractable: false`, conservée dans IndexedDB) : un script injecté peut l'utiliser
   tant qu'il tourne, pas la copier. secp256k1 reste permis (bibliothèques JS existantes), mais sa
   clé est forcément lisible par JavaScript.
5. **Prototype dans Adena**, directement sur `feat/gnoconnect-in-page` (fork `D4ryl00/adena-wallet`).
   Adena gère déjà les comptes de session (onbloc #853) mais **en secp256k1 seulement** : il faut lui
   apprendre à encoder une clé de session `/tm.PubKeyEd25519` et à vérifier une preuve Ed25519.
6. **Vérification** par une page de test (`~/bubblerumble/prototypes/inpage-sessions/`) et un banc
   **Playwright + Chromium** qui charge l'extension compilée et rejoue les scénarios, pour les deux
   types de clé, contre gnodev.
7. **Mobile inchangé**, sauf `disconnect` sans clé (décision 2).

## 3. Le standard

### 3.1 Launch links (#5970, repris dans #6016 par rebase)

Host `disconnect` :

| paramètre | sans clé | avec clé |
|---|---|---|
| `pubkey` | — | requis |
| `chainid`, `signer`, `iat`, `sig` | — | requis |
| `state` | optionnel, recommandé | requis |
| `callback` | optionnel | optionnel |

- Sans clé : le wallet termine ce qu'il garde pour cette dapp (rien pour gnokey-mobile aujourd'hui)
  et répond `success` sans `revoked`. Une requête sans clé n'est pas authentifiée : elle ne peut que
  retirer, jamais accorder ; le wallet demande à l'utilisateur avant toute révocation sur la chaîne
  (par exemple d'une session tenue par le wallet qu'il aurait créée pour les indications de cette
  dapp).
- Avec clé : inchangé.
- Le paragraphe « It ends a producer-held session… sends no request » devient : une dapp connectée
  sans clé peut envoyer un `disconnect` sans clé, ou simplement oublier l'adresse.

### 3.2 In-page (#6016)

```ts
connect(opts?: GnoConnectOptions): Promise<UserResponse<GnoAccount & Partial<GnoSessionGrant>>>;
disconnect(req?: GnoDisconnectRequest): Promise<UserResponse<{ revoked?: string; hash?: string }>>;

interface GnoConnectOptions {
  chainid?: string;                 // required as soon as pubkey is present
  allow?: string[];                 // scope hints, or the requested grant with pubkey
  spend?: string;
  period?: number;
  expires?: number;
  pubkey?: string;                  // producer-held session
  old?: string;
  signer?: string;
  state?: string;
  iat?: number;
  sig?: string;
  oldsig?: string;
}

interface GnoSessionGrant {
  session: string;     // bech32 address of pubkey — compare with your key
  expiresAt: number;
  allow: string[];
  spend: string;
  period: number;
  revoked?: string;
  hash?: string;
  features?: string[];
}

interface GnoDisconnectRequest {
  pubkey: string; chainid: string; signer: string; state: string; iat: number; sig: string;
}
```

Règles :

- **Champs et validation** : ceux du lien, mêmes bornes, mêmes erreurs. Avec `pubkey`, `chainid` et
  `state` deviennent requis (le `chainid` du `connect` in-page est sinon optionnel).
- **Payload** : mêmes lignes que pour le lien, construites depuis les champs — nombres en décimal,
  `allow` une ligne par entrée, champs absents omis — **sans `callback`**.
- **Origine approuvée** : la règle « `connect` sur une origine approuvée répond sans fenêtre » ne
  vaut plus quand la clé nommée n'est pas déjà une session couvrant la demande.
- **Revue** : l'**origine** (authentifiée par le navigateur) remplace l'hôte du callback ; le reste
  de la revue des sessions s'applique.
- **`disconnect(req?)`** : retire toujours l'approbation de l'origine, une fois l'appel terminé
  (la fenêtre de revue s'ouvre encore dans le contexte approuvé), puis émet l'événement `disconnect`.
  Avec `req` : preuve, `session_not_found`, confirmation, transaction ; refus → `Rejected`, échec →
  son code ; l'approbation est retirée dans tous les cas.
- **Détection** : un wallet qui accorde des sessions a la méthode `disconnect` et liste `sessions`
  dans `features`. Sans cela, `connect` dégrade comme sur mobile ; une page ne tient une session pour
  accordée que si `session` est l'adresse de sa clé, et une clé pour révoquée que si `revoked` l'est.
- **`ErrorCode`** gagne `invalid_proof`, `stale_request`, `session_expired`, `session_not_found`,
  `session_limit`.
- **Clés** : décision 4, dans « Proof of possession » (Ed25519 passe de MAY à MUST pour un wallet
  in-page) et dans les obligations du producteur (stockage non exportable dans le navigateur).
- La note « sessions are carried by launch links only » est remplacée par un renvoi vers cette
  partie. « Attenuated sub-sessions » reste hors périmètre.
- « Known Implementations » : Adena (prototype, fork) une fois vérifié.

## 4. gnokey-mobile (#138)

- Le cœur Go accepte un `disconnect` sans `pubkey` (ni `chainid`, `signer`, `iat`, `sig`) : rien à
  terminer, réponse `status=success` (+ `state`) si un `callback` sûr est présent, rien sinon. Pas
  d'écran.
- iOS et Android : le lien est accepté au lieu d'être répondu `invalid_request` ; tests unitaires
  (Go, XCTest, JUnit).
- Bubble Rumble n'est pas touché (il envoie toujours une clé).

## 5. Prototype Adena (`feat/gnoconnect-in-page`)

Existant réutilisé : fournisseur in-page (`src/inject/gnoconnect/`), routage vers la fenêtre de
revue, `getSession` / `getSessions` (`common/provider/gno/gno-provider.ts`), types et rendu des
messages `/auth.m_create_session` / `/auth.m_revoke_session`, `elliptic` (secp256k1).

- **Fournisseur** : `connect(opts)` transmet les champs ; nouvelle méthode `disconnect(req?)` ;
  `features` contient `sessions`.
- **Contrôles avant toute fenêtre** : champs et grammaire `allow` ; payload canonique ; preuve
  secp256k1 (`elliptic`) ou Ed25519 (WebCrypto) ; fenêtre `iat` (10 min / 1 min) ; mémoire des
  `(pubkey, state)` acceptés pendant 10 min (un doublon est ignoré).
- **`connect` avec clé** : réseau puis identité (`signer` ou choix de l'utilisateur ; compte actif
  qui est lui-même une session → `signer_unavailable`) ; session présente et valide → réponse lue
  sur la chaîne, sans transaction ; expirée → `session_expired` ; 16 sessions → `session_limit` ;
  revue (origine, réseau, identité, entrées `allow` avec avertissement sur les risquées, budget et
  pire cas, expiration, ancien / nouveau pour `old`, gas) ; transaction révocation de `old` (si sur
  la chaîne) + création, signée avec la clé de l'identité, diffusée ; attente de la session ;
  réponse `GnoSessionGrant`.
- **Encodage Ed25519** : `wrapSessionPubKey` choisit `/tm.PubKeyEd25519` ou `/tm.PubKeySecp256k1`
  selon la clé décodée du `gpub1…` (préfixe amino).
- **`disconnect(req?)`** : décision 2 et §3.2.
- **Indications de périmètre** : validées puis ignorées (MAY).
- **Hors prototype** : rétrécir l'autorisation dans la revue, ménage des sessions expirées,
  Ledger.
- **Tests jest** : payload (vecteur Go de référence), preuves des deux types, validation, encodage
  `/tm.PubKeyEd25519`, formes des réponses.

## 6. Page de test et banc d'essai

- `prototypes/inpage-sessions/` dans `~/bubblerumble` : page statique ; `session-request.js`
  (champs → payload → signature ; même logique que `src/session/gnoconnect.ts`, testée sous Node
  contre le vecteur Go) ; clé Ed25519 WebCrypto non exportable dans IndexedDB, ou secp256k1
  (option) ; encodage `gpub1…` ; boutons accorder / renouveler / déconnecter avec clé / déconnecter
  sans clé / `connect` simple ; lecture de la session sur la chaîne (`abci_query`) après chaque
  réponse.
- Banc Playwright (dépendance de développement du dossier seulement) : Chromium avec l'extension
  compilée, wallet initialisé avec la clé de test `test1` et le réseau gnodev local, page servie en
  local.
- Scénarios, pour chacun des deux types de clé :
  1. accord, session lue sur la chaîne avec les bons plafonds ;
  2. même `connect` rejoué : autorisation existante, sans transaction ;
  3. renouvellement avec `old` : une transaction, l'ancienne session disparaît ;
  4. `disconnect` avec clé : session révoquée, approbation retirée ;
  5. `disconnect()` sans clé : approbation retirée, rien sur la chaîne ;
  6. refus : preuve altérée → `invalid_proof` ; `iat` trop vieux → `stale_request` ; `old` égal à
     `pubkey` → `invalid_request` ;
  7. dégradation : la page reconnaît un `connect` sans session accordée.
- Hors périmètre : signer une transaction de jeu avec la clé de session depuis le navigateur
  (travail d'une bibliothèque côté dapp ; `tm2-js-client` ne connaît pas Ed25519).

## 7. Risques

- **Automatiser l'onboarding d'Adena** (création ou import du portefeuille, ajout du réseau gnodev)
  dans Playwright peut être laborieux ; repli : préremplir le stockage de l'extension.
- **WebCrypto Ed25519** dans le service worker de l'extension et dans la page : disponible dans les
  Chromium récents ; à vérifier avec la version de Playwright.
- **Encodage `/tm.PubKeyEd25519`** côté Adena : à valider sur gnodev avant d'écrire la règle MUST
  (création, puis révocation de la même clé).
- **Coordination Adena upstream** : le prototype reste sur ton fork ; une contribution à
  onbloc/adena-wallet est une décision séparée.

## 8. Ordre

Comme pour le mobile, le texte entre dans le standard une fois l'implémentation vérifiée, corrigé de
ce qu'elle aura appris.

1. gnokey-mobile : `disconnect` sans clé (#138).
2. `session-request.js` et la page de test.
3. Prototype Adena.
4. Banc Playwright et vérification des scénarios.
5. Standard : #5970 (`disconnect` sans clé), puis #6016 (partie in-page) par rebase, comme à
   l'étape 6 ; « Known Implementations ».
6. Spec §9, poussées (avec l'accord de l'utilisateur).
