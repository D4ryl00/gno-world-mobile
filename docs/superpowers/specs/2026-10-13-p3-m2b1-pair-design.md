# P3-M2b-1 : `/pair` — design

Premier des trois jalons de M2b, décidés le 2026-10-13 : **M2b-1 `/pair`** (appairage avec le site, carnet de
rooms, nom réservé), M2b-2 rooms (lire, écrire, créer, rejoindre, quitter, inviter, outils du créateur), M2b-3 DM et
amis (`/api/dm`, `/api/friends`, notes, lignes scellées). `/pair` passe avant les rooms : la clé d'un nom n'est
jamais réémise, `/pair` est le seul moyen d'amener `remi` dans l'app, et il fixe le format du carnet que M2b-2 lira.
Specs parentes : `2026-10-01-bubblerumble-mobile-design.md` (§5.4, §5.5), `2026-10-05-p3-m2a-chat-design.md`
(l'ancien découpage mettait `/pair` dans M2d), `2026-10-12-gnoconnect-challenge-design.md` §10.

## 1. Objectif

Appairer l'app avec gno.world dans un navigateur, dans les deux sens, pour que les deux gardent les mêmes rooms et le
même nom réservé, comme deux navigateurs appairés.

**Critères de réussite :**

1. L'app donne un code que le navigateur accepte, et l'app accepte un code donné par le navigateur.
2. Le nom réservé du navigateur arrive dans l'app (✓ dans le Chat, lignes postées sous ce nom), vérifié par le
   serveur avant d'être pris ; et un nom réservé dans l'app part vers le navigateur.
3. Les rooms du navigateur arrivent dans le carnet de l'app et y restent intactes (clés comprises) après des
   allers-retours ; une room quittée d'un côté disparaît de l'autre.
4. Le code de synchro de l'app produit et lit exactement les octets du site (test de fidélité contre le code du site
   rejoué dans Node, puis essai réel avec Chrome sur la production).

## 2. Périmètre

**Dans M2b-1 :** donner un code, saisir un code, la boucle de synchro (relire, écrire, fusionner), le nom reçu et
envoyé, le carnet de rooms (stocké, fusionné, renvoyé, listé en lecture seule), « stop », la présence groupée
(`g=`), le module natif PBKDF2, les routes du faux serveur, l'e2e de fidélité.

**Ailleurs :** ouvrir, lire, quitter, renommer une room (M2b-2 — qui écrira aussi `left`) ; DM, amis, lignes
scellées `🔒 e2e/1` (M2b-3) ; la synchro de disposition des fenêtres du site (`layoutPull`/`layoutPush`, autre id sur
la même route : propre au navigateur, jamais) ; un code QR (le site n'affiche que le texte).

**IRC :** le chat est aussi servi en IRC (`gno.world:6667`, `#public`, `#<id>` d'une room) et une room peut être
reliée à un canal extérieur. Pour M2b-1, seul compte le drapeau `irc: true` d'une entrée du carnet, gardé tel quel.
L'app reste en HTTP.

## 3. Le protocole du site

Lu dans le JS en ligne de gno.world le 2026-10-13 (`app-rooms.js` : `syncInit` … `syncAccept` ; `app-panels.js`,
`app-windows.js` : l'interface ; `app.js` : `presenceGroup`). Réponses d'erreur relues en GET sur la production le
même jour. Le comportement du site fait foi.

**Code :** 6 caractères tirés de `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (`octet % 31`), valable 10 min, **à usage
unique** (« no such code — it may have been used, or it is older than ten minutes »). Saisie normalisée : majuscules,
tout ce qui n'est pas `A–Z2–9` retiré, 6 caractères exactement (« a code is six letters and digits », aussi la
réponse 400 du serveur).

**Clés :**

- clé de synchro : 32 octets aléatoires (`br.synckey`, 64 hex) ; id = SHA-256 de la clé, en hex (64) ;
- clé du code : PBKDF2-SHA256, mot de passe = le code (UTF-8), sel = `"bubblerumble rooms " + code`, 200 000
  itérations, 256 bits, pour AES-GCM ;
- scellé : `iv (12 octets aléatoires) | chiffré | tag (16)`, en base64 standard.

**Routes :**

| Requête | Réponse |
|---|---|
| `POST /api/sync/pair` `{code, blob}` (blob = la clé de synchro scellée par la clé du code) | 200 ; 409 si le code existe (en tirer un autre, 3 essais) ; sinon `{error}` |
| `GET /api/sync/pair/<code>` | `{blob}` ; 404 `{error: "no such code — …"}` ; 400 code mal formé |
| `GET /api/sync/<id>` | 200, corps texte = le scellé en base64, `ETag` = version (nombre) ; 404 `{error: "nothing here yet"}` = version 0 |
| `PUT /api/sync/<id>` (`Content-Type: text/plain`, `If-Match: <version>`, corps = scellé en base64) | 200 + `ETag` (nouvelle version) ; 412 si la version a bougé |

**Contenu scellé :** `{rooms, left, name, at}` en JSON.

- `rooms` : `[{id, name, key, at, irc?}]` — `id` de 20 caractères `[A-Za-z0-9_-]`, `name` (40 au plus), `key` (la
  clé de créateur, `''` sinon), `at` (ms) ;
- `left` : `{id: ms}`, les rooms quittées ;
- `name` : `{name, key}` si le nom réservé a une clé de 32 à 64 hex, absent sinon ;
- `at` : ms de l'écriture.

**Rythme du site :** relecture toutes les 2 min et au retour au premier plan ; écriture 1,5 s après un changement du
carnet ; après avoir donné un code, relecture toutes les 5 s pendant 6 min ; sur 412, relire (et fusionner) puis
réessayer, 3 fois.

**Fusion (`syncMerge`) :** `left` = maximum par id des deux côtés ; rooms réunies par id, les locales d'abord : pour
un id déjà vu, un `at` plus récent remplace `at` et `name`, et une `key` manquante est reprise ; une room disparaît
si `left[id] > at` ; tri par `at` décroissant ; plafonds à l'enregistrement : 200 rooms avec clé, 30 sans.

**Nom reçu (`syncNameIn`) :** vérification `GET /api/name?name=<n>` avec `X-Name-Key: <clé reçue>` → `mine: true`
(oui), `mine: false` (non — relu sur la production : une mauvaise clé donne `mine: false`), échec réseau ou non-200
(inconnu). Issues : voir §5.3. Phrases (`syncPairWords`) reprises mot pour mot.

**Présence :** `POST /presence?id=<pid>&g=<16 premiers hex de l'id de synchro>` quand le navigateur est appairé : les
appareils appairés comptent pour une personne.

## 4. Architecture

```
modules/pbkdf2/                 module Expo local (npx create-expo-module --local) : pbkdf2Sha256(password, salt,
                                  iterations, length) → Uint8Array, asynchrone ; iOS CCKeyDerivationPBKDF
                                  (CommonCrypto), Android SecretKeyFactory("PBKDF2WithHmacSHA256")
src/offchain/sync/
  crypto.ts       SyncCrypto (random, sha256, pbkdf2, aesSeal, aesOpen) ; l'implémentation de l'app (expo-crypto +
                  modules/pbkdf2) ; codeKey, syncId, newCode, normalizeCode, seal/open en base64
  node-crypto.ts  la même interface sur node:crypto, pour jest et l'e2e
  rooms.ts        RoomEntry, Book {rooms, left} ; mergeBook() (copie de syncMerge), capBook() ; BookStore : le carnet
                  par serveur, scellé dans AsyncStorage par une clé locale gardée dans SecureStore
  name.ts         nameIn() (copie de syncNameIn, vérification injectée) → issue ; pairWords(issue, …) ; nameOut()
  client.ts       pairPost, pairGet, pull, push
  store.ts        zustand : état, offer(), accept(code), stop(), la boucle
src/offchain/http.ts            + `text()` : requête qui rend {status, text, etag} sans lever d'erreur sur 404/409/412,
                                corps texte (`text/plain`)
src/offchain/presence.ts        + le groupe `g`
src/offchain/chat/store.ts      + reloadIdentity()
src/state/app-services.tsx      la synchro au premier plan, la présence groupée, la poussée quand le nom change
src/app/pair.tsx, src/screens/pair/     l'écran ; bouton « pair » dans l'en-tête du Chat
scripts/fake-offchain/server.ts + /api/sync/*, `mine`, `g`
scripts/fake-offchain/site-sync.ts   le code de synchro du site recopié (WebCrypto, localStorage en mémoire)
scripts/fake-offchain/browser.mjs    ce « navigateur » en ligne de commande (npm run fake-browser), pour les appareils
e2e/pair.e2e.test.ts                 le store de l'app face à site-sync.ts
```

**Ce qui est gardé, et où** — tout **par serveur hors chaîne** (clé de stockage suffixée comme celle du nom) :

| Donnée | Où |
|---|---|
| clé de synchro (64 hex) et version | SecureStore (`br.sync.key.<serveur>`) ; la version en mémoire |
| carnet `{rooms, left}` | AsyncStorage (`br.rooms.<serveur>`), scellé AES-GCM par une clé locale (`br.rooms.lock`, SecureStore, 32 octets) : les clés de rooms ouvrent des rooms privées, et le carnet (jusqu'à ~16 Ko) dépasse ce que SecureStore garantit (~2 Ko sur certaines versions d'iOS) |
| nom réservé et sa clé | `IdentityStore` existant (`reservedName`, `nameKey`, déjà par serveur) |

Un carnet illisible (clé locale perdue, données abîmées) est traité comme vide, sans erreur bloquante.

**Liens avec l'existant :**

- nom pris : la synchro enregistre `{name, reservedName, nameKey}` dans l'`IdentityStore` puis appelle
  `chat.reloadIdentity()` ;
- nom envoyé : lu dans l'`IdentityStore` au moment d'écrire ;
- l'app réserve, prouve ou libère un nom : `app-services` voit `identity.reservedName`/`nameKey` changer dans le
  store du chat et demande une écriture (écart voulu avec le site, qui n'écrit qu'au changement du carnet) ;
- présence : `sendPresence(oc, pid, group)` ajoute `&g=` ;
- cycle de vie : démarrage au premier plan, arrêt en arrière-plan, redémarrage de zéro au changement d'URL du
  serveur, comme le chat ;
- M2b-2 lira et écrira le même `BookStore` et appellera `sync.changed()`.

## 5. Flux

### 5.1 Donner un code (`offer`)

1. Pas de clé de synchro : tirer 32 octets, les garder, relire (404 → version 0), fusionner, écrire. Déjà appairé :
   écrire.
2. Tirer un code, dériver sa clé, sceller la clé de synchro, `POST /api/sync/pair`. 409 : nouveau code (3 essais) ;
   autre erreur : son texte.
3. État `code` avec son expiration (10 min) ; relecture toutes les 5 s pendant 6 min, au premier plan.

### 5.2 Saisir un code (`accept`)

1. Normaliser ; refuser s'il n'a pas 6 caractères.
2. `GET /api/sync/pair/<code>` ; dériver la clé du code ; ouvrir ; refuser si l'ouverture échoue ou si la clé n'a
   pas 32 octets (« that code did not open the key »).
3. Confirmation par l'écran (`Alert` système) avant de garder la clé : « This code came from another device. Your
   rooms and their keys will be shared with it, and its rooms come here. Continue? » ; si l'app est déjà appairée,
   ajouter « This device leaves its current pairing. » (écart voulu : le site remplace sans le dire). Le store
   expose deux temps : `open(code)` rend la clé, `use(key)` l'adopte.
4. Garder la clé, relire, fusionner, décider du nom, écrire.
5. Rendre la phrase de l'issue.

### 5.3 Nom reçu

`check(name, key)` → `true` / `false` / `null`. `mine` = nom réservé local (`identity.reservedName`), `have` = sa clé.

| Cas | Issue | Effet |
|---|---|---|
| reçu invalide (clé hors `^[0-9a-f]{32,64}$`, nom vide) | `none` | — |
| clé reçue = `have` | `same` | — |
| `mine` présent, `check` reçu = `null` | `unknown` | garde le sien |
| `mine` présent, `check` reçu = `false` | `refused` | garde le sien |
| `mine` présent, même nom (casse ignorée) | `taken` | prend |
| `mine` présent, autre nom, `check(mine, have)` ≠ `false` | `kept` | garde le sien |
| `mine` présent, autre nom, `check(mine, have)` = `false` | `taken` | prend |
| pas de `mine`, `check` reçu = `false` | `refused` | — |
| pas de `mine`, sinon | `taken` (`unknown` si `null`) | prend |

« Prend » : `identity.save({name, reservedName: name, nameKey: key})` (nom coupé à 40), puis `reloadIdentity()`.
Le nom est revérifié à chaque relecture (comme le site) ; seules les issues autres que `none`/`same` sont rendues
à l'écran.

### 5.4 Boucle

- relecture : au démarrage (si appairé), toutes les 2 min, au retour au premier plan, et la relecture rapide de
  §5.1 ; une relecture fusionne le carnet et décide du nom ;
- écriture : 1,5 s après `changed()` (carnet ou nom) ; `If-Match: <version>` ; 200 → version = `ETag` ; 412 →
  relire puis réessayer, 3 fois ; autre échec → rien jusqu'au prochain changement ;
- une seule opération réseau à la fois (file) ; une époque écarte toute réponse arrivée après `stop()` ou un
  changement de serveur ;
- `stop()` : oublie la clé et la version (le carnet et le nom restent).

## 6. L'écran

Route de pile `/pair` (« Pair with a browser »), ouverte par un bouton « pair » dans l'en-tête du Chat, à côté de
« you » (libellé d'accessibilité « Pair with another device »). Corps dans `Page`.

1. **État** — non appairé : « Your rooms and your reserved name live in this app. Pair it with gno.world in a
   browser to have them on both. » ; appairé : « Paired — rooms and reserved name stay the same on your other
   devices », « last synced 1 min ago » ou « sync failed — retrying », et « Stop » confirmé (« This device stops
   syncing; the others keep on »).
2. **Get a code** — bouton (roue pendant la préparation), puis le code en grand, à chasse fixe, espacé,
   sélectionnable, lu caractère par caractère par les lecteurs d'écran ; « On the other device: /pair → enter this
   code · 9:42 left » ; à l'expiration, « expired — get another ».
3. **Enter a code** — champ (majuscules automatiques, sans correction, 7 caractères au plus), « Pair », puis la
   confirmation, puis la phrase de l'issue sous le champ.
4. **Name** — « remi ✓ », ou « no reserved name — the other device's comes along when you pair ».
5. **Rooms (N)** — le carnet, lecture seule : nom, 🔑 si l'app tient la clé de créateur, « IRC » ; pied : « Opening
   rooms comes with the next update. »

## 7. Erreurs

- action refusée (code inconnu, mal formé, qui n'ouvre pas la clé, 409 répétés) : le texte sous la section, le champ
  garde sa saisie ;
- serveur injoignable : « server unreachable — try again » sur l'action ; la synchro de fond ne dit rien hors de
  l'écran ;
- scellé illisible à la relecture (clé de synchro qui ne l'ouvre pas) : relecture en échec, « sync failed —
  retrying » ; rien n'est écrasé ;
- carnet local illisible : vide ;
- le module natif absent (Expo Go) : « this build cannot pair — update the app » ; le reste de l'app ne change pas.

## 8. Faux serveur

`scripts/fake-offchain/server.ts` gagne :

- `POST /api/sync/pair` : `{code, blob}` ; code de 6 caractères de l'alphabet sinon 400 ; 409 si le code existe et
  n'a pas expiré ; garde 10 min ;
- `GET /api/sync/pair/<code>` : 400 mal formé ; 404 avec la phrase de la production ; sinon `{blob}` et le code est
  consommé ;
- `GET /api/sync/<id>` (64 hex, sinon 404 texte) : 404 `{error: "nothing here yet"}` ou le texte et `ETag` ;
- `PUT /api/sync/<id>` : 412 si `If-Match` ≠ version courante (0 quand rien) ; sinon garde, version + 1, `ETag` ;
  corps de 64 Ko au plus ;
- `GET /api/name` : `mine: <X-Name-Key = clé du nom>` quand le nom est réservé (et `addr` si `mine`) ;
- `/presence` : `g` accepté (compté une fois par groupe) ;
- route de test `POST /__test/name` : réserver un nom pour une clé donnée (le « navigateur » de l'e2e a un nom sans
  passer par un boop).

## 9. Tests

- **Unitaires (jest) :** vecteurs fixes (code, IV et clé de synchro donnés → blob attendu, produit par le code du site
  avec WebCrypto, script `scripts/sync-vectors.mjs`) ouverts et reproduits par `crypto.ts` sur `node-crypto.ts` ;
  `syncId`, alphabet, normalisation ; `mergeBook` cas par cas ; `nameIn` ligne par ligne du tableau §5.3 et les
  phrases ; `BookStore` (aller-retour scellé, illisible → vide, par serveur, plafonds) ; `http.text()` (corps texte,
  `ETag`, `If-Match`, 404/409/412 rendus) ; store avec un faux serveur en mémoire (404 → version 0, 412 → relecture
  et 3 essais, relecture rapide, époque, stop, changement de serveur, écriture après `changed()`) ; présence `g` ;
  `reloadIdentity`.
- **E2e (`npm run e2e:pair`) :** le vrai store de l'app (crypto Node) contre le faux serveur, face à
  `scripts/fake-offchain/site-sync.ts`, le code de synchro du site recopié (`syncOffer`, `syncAccept`, `syncMerge`,
  `syncNameIn`, `syncPush`, `syncPull`) sur WebCrypto avec un `localStorage` en mémoire. Scénarios : l'app donne le code et le
  navigateur le saisit ; l'inverse ; nom `taken` (navigateur → app), nom envoyé (app → navigateur), `kept`,
  `refused` ; rooms réunies avec leurs clés, room quittée d'un côté ; deux écritures concurrentes (412) ; code
  consommé.
- **Manuel :** simulateur iOS 26.5 et émulateur Android contre le faux serveur, appairés avec le « navigateur »
  en ligne de commande (`npm run fake-browser -- offer` ou `-- accept <code>`, le même `scripts/fake-offchain/site-sync.ts`, avec un
  nom et des rooms de départ) — seule preuve que le module natif donne les bons octets ; puis production avec le Chrome de l'utilisateur, qui pose `remi` (clé de `~/namekey-remi.json`) :
  appairage dans les deux sens, `remi` ✓ dans l'app. Aucune écriture automatique vers la production.

## 10. Décisions

- Découpage M2b-1 / M2b-2 / M2b-3, `/pair` d'abord (choix du 2026-10-13).
- L'écran d'appairage s'ouvre depuis l'en-tête du Chat (choix du 2026-10-13).
- PBKDF2 par un module Expo local ; AES-GCM et SHA-256 par expo-crypto (choix du 2026-10-13). PBKDF2 en JS écarté :
  200 000 itérations prennent 18,6 s sous Node sans JIT sur un Mac, plus encore sous Hermes sur un téléphone.
- Tout est rangé par serveur hors chaîne ; le carnet est scellé dans AsyncStorage par une clé locale de SecureStore.
- Écarts voulus avec le site : écriture quand le nom change ; la confirmation dit qu'un appairage existant est
  remplacé.
