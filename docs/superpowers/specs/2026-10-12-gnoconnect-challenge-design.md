# GnoConnect — prouver son identité : `connect` + `challenge` — design

Date : 2026-10-12. Suite de P3-M2a (`2026-10-05-p3-m2a-chat-design.md`) : la réservation d'un nom
sur gno.world, faite entièrement depuis le téléphone avec gnokey-mobile.

**Statut (2026-10-13) :** étapes 1 à 5 livrées (plan `docs/superpowers/plans/2026-10-12-gnoconnect-challenge.md`) :
standard #5970 `a5627a483`, #6016 `cb66934bc` ; gno `feat/gnokey-pair` `724f35fd9` ; gnokey-mobile
`4633429..324a132` ; app `c9a7dcf..ab2efff`. Vérifié sur simulateur iOS et émulateur Android.
Corrections de la revue finale faites le 2026-10-13 (plan, « Corrections to make ») : standard #5970
`a548c81b7` (`signer` sur un `connect` d'identité, vérification du document par le producteur),
#6016 rebasée `fea266219` ; gnokey-mobile `caaa012..d29b60e` ; app `004b956..8f78391` ; revérifié
sur simulateur iOS (lancements à froid) et émulateur Android. Adena (§8) livré le 2026-10-13 : fork `feat/gnoconnect-in-page` rebasée sur l'amont `a4bba353` (sauvegarde `backup/gnoconnect-in-page-before-sign-arbitrary`), `connect({challenge})` par `SignArbitrary` (`4d80adea`, `c652fca1`, `07e44416`), banc 23/23 avec une réservation par preuve contre le faux serveur ; #6016 `93521c302`. Reste l'essai de l'utilisateur sur la production.

## 1. Intention

**Objectif (dit par l'utilisateur).** Utiliser gno.world à 100 % sur mobile avec gnokey-mobile, sans
dépendre du site web ; en particulier réserver un nom depuis l'app.

**Critère de succès.** Depuis l'app gno.world, sur un téléphone apparié à un ordinateur (gnokey-pair),
l'utilisateur réserve un nom sur la production : l'app demande une preuve d'identité par `connect` +
`challenge`, gnokey-mobile la fait signer par la clé maître sur l'ordinateur, et gno.world l'accepte
sans aucun changement de son serveur. Vérifié de bout en bout sur simulateur iOS et émulateur Android.

**Préférences retenues (2026-10-12).**

- Parité des transports (liens de lancement et in-page) : mêmes verbes, mêmes champs, mêmes règles.
- La preuve est faite par la **clé maître**, pas par une clé de session : une signature ne se vérifie
  qu'avec la clé publique de la clé qui a signé, et gno.world compare l'adresse dérivée de `pub` à
  `addr`. La session reste donc invisible aux dapps.
- gnokey-mobile ne détient que des clés de session ; la clé maître signe sur l'ordinateur, par gnokey
  CLI, lancé par gnokey-pair ou par l'utilisateur.

## 2. Ce que l'on sait de gno.world (vérifié sur la production le 2026-10-12)

- `POST /api/name {name, addr}` → 409 tant que le wallet n'est pas prouvé : « Connect your wallet and
  let it sign the phrase… A boop from the last 3 minutes in this browser does the same ».
- Preuve : `GET /api/name/challenge` → `{words}` (« gno.world: prove this wallet is yours · <jeton> »),
  signé par Adena `SignArbitrary` ; puis `POST /api/name {name, doc, sig, pub, addr}`, où `doc` est le
  document signé en JSON trié sans espaces (`<`, `>`, `&` échappés), `sig` et `pub` en base64 (`pub` =
  la clé compressée, 33 octets).
- Le serveur dérive l'adresse de `pub` et la compare à `addr`. Une clé qui est une **session active**
  de `addr` sur `gnoland-1` est refusée (« that key belongs to g1… ») : il ne lit pas les sessions.
- Un nom par wallet ; la clé du nom n'est **jamais réémise** : une nouvelle preuve valide de l'adresse
  propriétaire reçoit 409 « this wallet holds the name … already ». La clé ne circule que par `/pair`
  (M2b) ; perdue, seul l'opérateur libère le nom.
- `gnokey sign-data` (§3) a réservé `remi` pour `g1mzn3k8pp4xv720g2ka0ndx8fk7juwuea6knc0p` : la sortie de
  gnokey est acceptée telle quelle.

## 3. Déjà fait : `gnokey sign-data` (gno, `feat/gnokey-sign-data`, `38723ce23`)

Branche partie de gnolang/gno master (`b19bd7de5`), non poussée.

- `tm2/pkg/std/signdata.go` : `SignDataPayload(chainID, signer, data)` construit les octets du
  document `SignArbitrary` d'Adena (ADR-036 `sign/MsgSignData`, `chain_id` gardé, `account_number`,
  `sequence`, `gas` à `"0"`, `fee.amount` vide, `memo` vide) ; `VerifySignData(doc, pub, sig)` relit un
  document dans n'importe quel ordre de clés, refuse toute autre forme, vérifie que `pub` est la clé du
  signataire puis la signature, et rend `{ChainID, Signer, Data}`.
- `gnokey sign-data -chainid <id> (-data | -data-path) [-output-document] <clé>` : sortie = la réponse
  `SignArbitrary` d'Adena (`{signed, signature: {pubKey: {typeUrl, value}, signature}}`).
- Interopérabilité vérifiée dans les deux sens avec cosmjs (la pile d'Adena) ; doc dans
  `docs/users/interact-with-gnokey.md`.

## 4. Le standard GnoConnect (#5970 liens, #6016 in-page)

**Requête.** `connect` gagne un paramètre facultatif `challenge` :

```
land.gno.gnokey://connect?challenge=<texte>&signer=<bech32>&chainid=<id>&callback=<url>&state=<jeton>
```

In-page : `connect({ challenge, signer?, chainid? })`.

- `challenge` : texte UTF-8 non vide, 4096 octets au plus, sans caractère de contrôle (C0, DEL, C1, au
  sens de `unicode.IsControl`) ; sinon `invalid_request`.
- **Un `connect` qui nomme une clé (`pubkey`) et porte un `challenge` est `invalid_request`**, sur les
  deux transports : un `connect` crée une session ou prouve une identité, pas les deux. Cela évite deux
  signatures de l'identité dans un même échange.
- `chainid` et `signer` se résolvent comme ailleurs (Network resolution, The `signer` pin).

**Document signé.** Celui de `std.SignDataPayload` (§3), par l'**identité**, jamais par une clé de
session, avec le `chain_id` de la réponse.

**Réponse.**

```
<callback>?status=success&address=<bech32>&pubkey=<gpub>&chainid=<id>&signed=<base64url>&signature=<base64url>&features=<…>&state=<…>
```

- `signed` : les octets canoniques signés (le JSON trié), en base64url sans remplissage ; `signature` :
  64 octets `R‖S`, base64url sans remplissage ; `pubkey` devient obligatoire avec un challenge.
- In-page : `GnoAccount` gagne `proof?: { signed: TxSignPayload; signature: string }` (l'objet, comme
  Adena ; la signature en base64).
- `session` (la clé déléguée du wallet) n'apparaît pas dans une réponse à un challenge.

**Revue.** Avec un challenge le wallet demande toujours l'accord de l'utilisateur, même pour une
origine déjà approuvée in-page. Il montre l'hôte du callback (ou l'origine), l'identité, le réseau, le
texte en entier, et que rien ne part sur la chaîne.

**`features`.** Jeton `challenge`. Un wallet qui ne le connaît pas ignore le paramètre (compatibilité
ascendante) et répond sans `signed` ni `signature` : le producteur n'est prouvé que si la réponse les
porte, et sinon passe à une autre voie sans redemander.

**Texte.** La phrase de `connect` « A proof-of-control extension (challenge + signature) is left for
producers… » devient la définition de `challenge` ; « Message signing is deliberately absent »
précise que la preuve d'identité passe par `connect` + `challenge` et qu'une signature de déclaration
arbitraire reste hors du standard. Le standard laisse au producteur : fabriquer le challenge (frais,
à usage unique, avec son domaine), vérifier la signature et l'adresse de `pubkey`, refuser un réseau
inattendu.

## 5. gnokey-pair (gno, `feat/gnokey-pair`)

- **Base.** `feat/gnokey-pair` est rebasée sur `feat/gnokey-sign-data` (elle a besoin de
  `std.VerifySignData`).
- **Protocole** (`contribs/gnokey-pair/protocol`) : `KindData = "data"` ; `Request.Data` (le texte) ;
  `Result.Proof` (la sortie JSON de `gnokey sign-data`, telle quelle). `data` n'est annoncé dans
  `kinds` que si le `gnokey` utilisé a `sign-data` (essayé au démarrage).
- **Côté ordinateur.** Revue : texte en entier, signataire, réseau, « nothing goes on chain ». Puis
  `gnokey sign-data -chainid <ChainID> -data-path <fichier> -output-document <fichier> <Signer>`, lancé
  par gnokey-pair ou montré en mode « à la main » (gnokey-pair relit le fichier) ; enfin
  `std.VerifySignData` : signataire `Request.Signer`, réseau `Request.ChainID`, texte `Request.Data`,
  sinon une erreur, rien n'est renvoyé. Aucun appel réseau.
- **Tests** : analyse et refus de la requête `data`, la revue, la commande lancée et la commande « à la
  main », la vérification du résultat (un `gnokey` factice dans les tests, comme pour `tx`), la
  négociation de `kinds`.

## 6. gnokey-mobile (cœur Go, puis iOS et Android)

- **Lecture du lien.** `connect` accepte `challenge` (règles du §4) ; avec `pubkey` :
  `invalid_request`.
- **Revue.** L'écran de connexion existant montre en plus le texte du challenge, l'hôte du callback et
  « prove this account is yours — nothing goes on chain ». Le compte choisi donne l'identité.
- **Signature.** Toujours par « Send to my computer » : une requête `data` si l'ordinateur annonce
  `data`, sinon un message (mettre à jour gnokey-pair ou gnokey). Pas de voie « à la main » côté
  téléphone : une signature hors chaîne ne laisse rien que le téléphone puisse guetter ; celle de
  gnokey-pair en tient lieu.
- **Contrôle.** Le cœur Go vérifie `Result.Proof` avec `std.VerifySignData` (signataire = l'identité,
  réseau et texte attendus) avant de répondre ; puis la réponse du §4 avec `features` incluant
  `challenge`.
- **Sans ordinateur apparié**, ou si l'utilisateur renonce : `cancelled` ; ordinateur qui n'annonce pas
  `data` ou qui échoue : `error&code=signer_unavailable`.
- **Neutralité.** Tests et fixtures sans nom de dapp (`exampledapp://session-callback`,
  `https://example.com/cb`).
- **Branche.** `feat/send-to-computer`, la seule où vit « Send to my computer » (elle est rebasée sur
  `feat/deeplink-tx`, PR #138). Le cœur suit la branche gno `feat/gnokey-pair` rebasée (§5) et
  `feat/gnokey-sign-data`, par des `replace` vers le fork D4ryl00/gno : ces deux branches sont poussées
  avant, sur accord de l'utilisateur.
- **Tests** : cœur Go (lecture, refus, réponse, vérification de la preuve, échanges avec un relais de
  test comme `mobile/pair_test.go`), puis iOS et Android (lien, revue, réponse), et un aller-retour sur
  simulateur et émulateur avec un vrai gnokey-pair.

## 7. L'app gno.world

**Réservation** (feuille du nom) :

1. `POST /api/name {name, addr}` (`addr` = l'identité de la session) ; 200 → réservé (un boop de moins
   de 3 minutes suffit, comme sur le site).
2. 409, quel que soit son texte (comme le site, qui passe alors toujours à la signature ; un 409
   « this wallet holds the name … already » revient après la signature et s'affiche) :
   `GET /api/name/challenge`, puis
   `land.gno.gnokey://connect?challenge=<words>&signer=<identité>&chainid=<réseau>&callback=gno.world://session-callback&state=<…>`.
3. Retour `success` avec `signed` et `signature` : `POST /api/name {name, doc, sig, pub, addr}` avec
   `doc` = les octets `signed` décodés (déjà triés et échappés comme l'attend le site), `sig` en
   base64, `pub` = la clé compressée tirée du gpub, en base64. Un retour sans preuve : « your wallet
   cannot prove the account — boop, then reserve within 3 minutes ».
4. Tout autre refus du serveur, au premier ou au second `POST`, s'affiche tel quel.

- La clé du nom reçue est gardée comme aujourd'hui (SecureStore, par serveur).
- Le texte de la feuille : « your wallet signs a phrase on your computer — or boop, then reserve
  within 3 minutes ».
- **Faux serveur** (`scripts/fake-offchain`) : `GET /api/name/challenge` (à usage unique), vérification
  réelle (document reconstruit, secp256k1 de Node, adresse dérivée de `pub`), un nom par wallet, le
  boop valable 3 minutes.
- **Tests** : unitaires (lien `connect` avec `challenge`, lecture de la réponse, conversion gpub →
  clé compressée, forme du `POST`), e2e contre le faux serveur avec une preuve signée par une clé de
  test, et un essai réel de l'utilisateur sur la production (un nom libre, un wallet sans nom).

## 8. Le fork Adena — fait, voir `2026-10-13-adena-connect-challenge-design.md`

Rebase de `feat/gnoconnect-in-page` (fork D4ryl00) sur upstream `main`, qui apporte `SignArbitrary`
(#931) ; `connect({challenge})` dans le provider GnoConnect, qui réutilise `signArbitraryMessage`, avec
la règle « toujours demander avec un challenge » ; tests sur le banc Playwright.

## 9. Ordre

1. Standard (#5970, #6016).
2. gno : gnokey-pair rebasée sur `feat/gnokey-sign-data`, type `data`.
3. gnokey-mobile : cœur Go.
4. gnokey-mobile : iOS et Android.
5. App gno.world et faux serveur.
6. Adena (§8).

Les étapes 1 à 5 suffisent à l'essai de bout en bout sur le téléphone.

## 10. Hors périmètre et questions ouvertes

- Preuve par clé de session vérifiée sur la chaîne : écartée (pas transparente pour les dapps ; et une
  session confiée à une dapp suffirait à prouver l'identité).
- `verify-data` dans gnokey, signature de déclarations arbitraires : non.
- `/pair` (rooms et nom entre l'app et le site) : avec M2b. La clé de `remi` fait 32 caractères
  hexadécimaux alors que la synchro du site n'accepte que 64 (`syncNameOut`, `syncNameIn`) : à
  vérifier à ce moment-là.
- Publication des branches (gno, gnokey-mobile, standard) : sur accord de l'utilisateur, comme
  toujours.
