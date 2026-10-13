# Adena — `connect({challenge})` dans le provider GnoConnect — design

**Statut :** livré le 2026-10-13 (plan `docs/superpowers/plans/2026-10-13-adena-connect-challenge.md`) : fork `feat/gnoconnect-in-page` rebasée sur l'amont `a4bba353` (sauvegarde `backup/gnoconnect-in-page-before-sign-arbitrary`), `connect({challenge})` par `SignArbitrary` (`4d80adea`, `c652fca1`, `07e44416`), banc 23/23 avec une réservation par preuve contre le faux serveur ; #6016 `93521c302`.

Date : 2026-10-13. Suite de `2026-10-12-gnoconnect-challenge-design.md` (§8 : « Le fork Adena, en
dernier, spec et plan à part »). Le transport in-page rejoint les liens de lancement, déjà livrés et
vérifiés (gnokey-mobile, iOS et Android).

## 1. Intention

**Objectif.** Une page web prouve l'identité de l'utilisateur par GnoConnect in-page, avec les mêmes
règles que les liens de lancement (parité des transports) : `connect({ challenge, signer?, chainid? })`
répond par l'identité, sa clé publique et la preuve signée, que le producteur vérifie comme gno.world
vérifie la sortie `SignArbitrary` d'Adena.

**Pour qui (choix de l'utilisateur, 2026-10-13).** Une vraie page à terme, gno.world. Mais le site
n'utilise pas GnoConnect aujourd'hui (il parle seulement à `window.adena`, et `walletProve` appelle
`adena.SignArbitrary`), et son code n'est pas le nôtre : **pas de patch du site pour l'instant** (option
C). Le banc reproduit exactement ce que le site ferait ; le changement côté site attendra son adoption
de GnoConnect.

**Critère de succès.** Sur le banc Playwright, une page obtient un challenge du faux serveur
(`scripts/fake-offchain`), appelle `connect({challenge})`, l'utilisateur approuve dans la fenêtre
d'Adena, la page convertit la preuve et le faux serveur réserve le nom après sa vérification réelle.
Les cas de refus répondent les codes du standard. Les 19 scénarios existants du banc restent verts
après le rebase.

## 2. Ce qui existe

- **Fork** `~/adena-wallet`, branche `feat/gnoconnect-in-page` (fork D4ryl00, pas de contribution
  amont) : 26 commits au-dessus de `upstream/main` d'août ; provider GnoConnect
  (`src/inject/gnoconnect/provider.ts`), sessions in-page, banc 19/19.
- **Amont** (`onbloc/adena-wallet` `main`, 69 commits de plus) : `SignArbitrary` (#931, #943). Le
  background valide (adresse, texte non vide, 4096 octets UTF-8 au plus), refuse un signataire autre
  que le compte courant (`ACCOUNT_MISMATCH`) avant toute fenêtre, puis ouvre toujours la fenêtre
  `approve-sign-arbitrary` : site, réseau, « Fee: None », signataire, texte entier, avertissement.
  Le document signé est celui de `std.SignDataPayload` (ADR-036, `chain_id` du réseau actif) ; la
  réponse est `{signed: TxSignPayload, signature: {pubKey: {typeUrl, value: clé compressée base64},
  signature: base64}}`. Il ne vérifie pas l'absence de caractères de contrôle.
- **Le standard in-page** (#6016, `fea266219`) : `connect(opts)` avec `challenge?`, `GnoAccount.proof?:
  {signed: TxSignPayload; signature: string}`, toujours demander avec un challenge, `pubkey` obligatoire
  avec une preuve, pas de `session`.

## 3. Le rebase

1. Sauvegarde : `backup/gnoconnect-in-page-before-sign-arbitrary`.
2. `git rebase upstream/main` des 26 commits. Les conflits attendus viennent des correctifs GnoConnect
   de l'amont (#884…) et du passage à tm2-js-client 3.0 / gno-js-client 2.2 (#899). Règle : garder le
   comportement du fork, sauf quand l'amont a corrigé la même chose (alors l'amont), et le noter.
3. Avant tout code nouveau : tests unitaires de l'extension et d'`adena-module`, build, banc 19/19.
4. Le fork n'est poussé (force-with-lease) qu'avec l'accord de l'utilisateur.

## 4. Le provider : `connect` avec un challenge

Dans `provider.ts`, `connect(opts)` route un `opts.challenge` défini vers `connectWithChallenge`,
composé d'appels existants (approche retenue : rien de nouveau dans le background) :

1. **Validation**, sans fenêtre : avec `pubkey` → `Rejected invalid_request` ; `challenge` vide, de
   plus de 4096 octets UTF-8, ou contenant un caractère de contrôle (C0, DEL, C1, comme
   `unicode.IsControl` de Go) → `Rejected invalid_request`. Les indices de portée restent validés comme
   aujourd'hui.
2. **Origine** : `addEstablish` ; un refus répond `Rejected` avec son code (premier passage : deux
   fenêtres, le site puis la signature — accepté).
3. **Réseau** : si `chainid` nomme une autre chaîne que l'active, `switchTo`, comme `sendTx` ; un
   réseau inconnu ou refusé répond comme pour `sendTx` (`network_declined`).
4. **Signataire** : le `signer` épinglé, sinon le compte courant ; une épingle autre que le compte
   courant répond `signer_unavailable` avant toute fenêtre (`assertSigner` existant).
5. **Signature** : `executor.signArbitrary({signer, data: challenge})` — la fenêtre amont s'ouvre
   toujours, même pour une origine déjà approuvée. `ACCOUNT_MISMATCH` → `signer_unavailable` (table
   existante) ; un refus de l'utilisateur → `Rejected` sans code ; une réponse sans clé publique ou
   sans signature (compte Ledger) → `signer_unavailable`.
6. **Réponse** `Approved` : `{address: signer, chainid: chaîne active, pubkey, features, proof:
   {signed, signature}}` — `pubkey` est le gpub reconstruit de la clé compressée (préfixe protobuf Any
   `0a13 "/tm.PubKeySecp256k1" 1223 0a21` + 33 octets, bech32 `gpub`), `features` contient
   `challenge`, pas de `session`. Le compte est retenu comme pour un `connect` simple.

`FEATURES` (la liste annoncée par tout `connect`) gagne `challenge`.

## 5. Le standard in-page (#6016)

Deux phrases, sur la branche in-page seulement (#5970 inchangée) :

- Dans « The `signer` pin » : la latitude vers une clé déléguée ou de session ne vaut pas avec un
  `challenge` — l'identité signe (Proving the identity).
- Dans la preuve in-page : `proof.signed` est un objet ; le producteur en refait les octets canoniques
  (JSON trié, sans espaces, `<`, `>`, `&` échappés) avant de vérifier, comme pour `signed` en base64url
  sur un lien.

## 6. Tests

**Unitaires (jest, extension)**, chacun vu en échec d'abord :

- provider, hôte factice comme dans les specs existantes : règles (vide, trop long, caractère de
  contrôle, avec `pubkey`) → `invalid_request` sans appel à l'exécuteur ; établissement refusé →
  `Rejected` ; `chainid` d'une autre chaîne → `switchTo` avant la signature ; épingle autre que le
  compte courant → `signer_unavailable` sans `signArbitrary` ; `ACCOUNT_MISMATCH` et refus → leurs
  codes ; réponse sans clé → `signer_unavailable` ; succès : gpub, `proof`, `features` avec
  `challenge`, sans `session` ;
- conversion clé compressée → gpub : vecteur connu (test1), clé qui ne fait pas 33 octets refusée ;
- recoupement avec Go : pour la clé et le texte du vecteur de `TestVerifySignData_AcceptsOtherImplementations`
  (gno `feat/gnokey-sign-data`, `tm2/pkg/std/signdata_test.go`), le `sign-arbitrary` d'`adena-module`
  donne les mêmes octets signés et la même signature (secp256k1 déterministe) — plutôt qu'une étape Go
  dans le banc.

**Banc** (`prototypes/inpage-sessions/bench`, gnodev, faux serveur) — une page de test qui fait ce que
ferait le site :

1. réservation par preuve : `GET /api/name/challenge` → `connect({challenge, signer, chainid: 'dev'})`
   → approbation → conversion (`signBytesOf(proof.signed)`, signature, clé compressée tirée du gpub)
   → `POST /api/name` → réservé par test1 ;
2. toujours demander : origine déjà approuvée, la fenêtre s'ouvre quand même ; refus → `Rejected` ;
3. épingle non détenue → `signer_unavailable`, aucune fenêtre ;
4. challenge avec un caractère de contrôle → `invalid_request`, aucune fenêtre ;
5. premier passage : fenêtre du site puis fenêtre de signature, les deux approuvées → succès.

Plus les 19 scénarios existants.

## 7. Documentation

Spec challenge (§8 et statut), spec principale §9, README du banc ; le standard selon §5.

## 8. Fin

Tests unitaires et banc verts ; liste pour l'utilisateur de ce qui est à pousser : fork Adena
(force-with-lease après le rebase) et #6016.

## 9. Hors périmètre

- Le site gno.world (pas de patch, cf. §1) ; une migration GnoConnect du site.
- Une fenêtre GnoConnect propre (l'écran amont suffit) ; une fenêtre combinée site + signature.
- Les liens de lancement côté Adena.
