# P3-M2b-2 : rooms — design

> **2026-10-30 :** les écrans (§6 : liste de conversations, `room/[id]`) sont remplacés par des onglets de canaux,
> voir `2026-10-30-chat-channel-tabs-design.md`. Le reste fait foi.

Deuxième des trois jalons de M2b (découpage du 2026-10-13) : M2b-1 `/pair` (livré), **M2b-2 rooms**, M2b-3 DM et amis
(`/api/dm`, `/api/friends`, notes, lignes scellées `🔒 e2e/1`). M2b-1 a posé le carnet de rooms (`BookStore`, synchronisé
avec le navigateur, listé en lecture seule) ; M2b-2 l'ouvre. Specs parentes : `2026-10-01-bubblerumble-mobile-design.md`
(§5.4, §5.5), `2026-10-05-p3-m2a-chat-design.md` (le chat principal), `2026-10-13-p3-m2b1-pair-design.md` (le carnet).

## 1. Objectif

Lire et écrire dans les rooms de gno.world depuis l'app, en créer, en rejoindre, en quitter, inviter quelqu'un, recevoir
une invitation, et tenir une room qu'on a créée (renommer, lister, épingler, retirer une ligne, supprimer la room),
avec les mêmes règles que le site et le même carnet que le navigateur appairé.

**Critères de réussite :**

1. Une room créée dans l'app s'ouvre dans le navigateur par son lien, et inversement ; les lignes passent dans les deux
   sens.
2. Une room rejointe, créée ou quittée dans l'app l'est aussi dans le navigateur appairé (carnet et `left`, par `/pair`).
3. Une invitation envoyée depuis le site met la room en tête de la liste de l'app, avec une bannière si elle a moins
   d'une heure.
4. Avec la clé de créateur, l'app renomme, liste ou retire de la liste, épingle, retire une ligne, invite et supprime la
   room ; sans elle, ces actions n'apparaissent pas.
5. Au plus deux long-polls ouverts (Public et la room à l'écran) ; les autres rooms montrent leurs non-lus par relevé.

## 2. Périmètre

**Dans M2b-2 :** la liste des conversations (Public et carnet), une room en plein écran, la feuille ＋ (créer, rejoindre
par lien, rooms publiques), quitter, inviter, recevoir une invitation (`dm` de `kind: "room"`), les outils du créateur
(renommer, lister, épingler, retirer une ligne, supprimer la room), les non-lus par relevé, le découpage du store du
chat en un store d'identité et un store par room, les routes du faux serveur, l'e2e.

**Ailleurs :** `/claim` (nouvelle clé de créateur signée par le wallet) et le pont IRC (`/irc bridge`) — un jalon
suivant ; les DM et les autres `kind` de `dm` (M2b-3) ; musique, voix, mèmes, pièces jointes (M2c) ; la présence
« people here » détaillée (M2d) ; les universal links `https://gno.world/#r/…` (un lien collé suffit).

**Hypothèses validées (2026-10-13) :** vérification sur le faux serveur écrit d'après le JS du site, puis production
en lecture seule et un court passage dans une room privée créée pour l'occasion ; IRC, musique, voix et DM hors
périmètre.

## 3. Le protocole du site

Lu dans le JS en ligne de gno.world le 2026-10-13 (`app-rooms.js` : `roomOpen`, `roomJoin`, `roomMake`, `roomLeave`,
`roomForget`, `roomRemember`, `roomInvite`, `roomDelete`, `chatWithdraw` ; `app-panels.js` : `roomPin`, `roomRename`,
`roomPublicWire`, `roomDrop`, la feuille ＋ ; `app-chat.js` : `chatLoop`, `roomRenameCmd` ; `app-form.js` : `chatVote`,
`chatReact`, `chatReport` ; `chatedit.js`). `GET /api/rooms` et `GET /api/room?id=` relus sur la production le même
jour. Le comportement du site fait foi.

**Une room est le chat avec `room=<id>`.** L'id (20 caractères `[A-Za-z0-9_-]`) suffit pour lire et écrire ; une room
non listée n'est connue que par son lien. Public est la room sans id.

| Action | Requête dans une room |
|---|---|
| poll, plus anciennes, plus récentes | `GET /api/chat?…&room=<id>` (`since`/`wait`/`limit`/`gen`, `before=`, `after=`) ; le poll porte aussi `&name=<nom affiché>` (96 caractères au plus), dans Public comme dans une room |
| écrire | `POST /api/chat?room=<id>` `{name, body, re?, av?, avkey?}` |
| modifier | `PATCH /api/chat?id=<n>&room=<id>` `{body}` |
| reprendre sa dernière ligne | `POST /api/chat/withdraw?room=<id>` |
| saisie en cours | `POST /api/chat/typing?room=<id>` |
| réagir, voter | `POST /api/chat/react`, `POST /api/chat/vote` avec l'en-tête **`X-Room: <id>`** |
| signaler | `POST /api/chat/report?id=<n>&room=<id>` |
| épingler (créateur) | `POST /api/chat/pin?id=<n>[&on=0]&room=<id>` + `X-Room-Key` → `{pins, msg?}` |
| retirer une ligne (créateur) | `DELETE /api/chat?id=<n>&room=<id>` + `X-Room-Key` |

Les en-têtes habituels (`X-Name-Key`, `X-Owner` quand il existe) accompagnent chaque écriture, comme dans M2a.

**Routes des rooms :**

| Requête | Réponse |
|---|---|
| `POST /api/room` `{name, public}` | `{id, name, key}` ; sinon `{error}` |
| `GET /api/room?id=<id>` | `{id, name, public, here, made, announce}` ; 404 `{error: "no such room — the link may be wrong, or the room was quiet for a month and is gone"}` |
| `POST /api/room?id=<id>` `{name}` ou `{public}` + `X-Room-Key` | 200 `{name?}` ; sinon `{error}` |
| `DELETE /api/room?id=<id>` + `X-Room-Key` | 200 ; sinon `{error}` |
| `GET /api/rooms` | `{rooms: [{id, name, slug, here, voice, made, lat, lon}]}` (les rooms listées) |
| `POST /api/room/invite?room=<id>` `{to, tag, name}` + `X-Room-Key` | 200 `{to}` ; sinon `{error}` (le créateur ou l'owner seulement) |

**Le poll d'une room** rend aussi `name` (le nom de la room, s'il a changé) et `here`. Un 404 au poll d'une room : le
site réessaie après 20 s, et au troisième 404 dit « "X" is gone — the room was quiet for a month » et la quitte.

**Invitations :** une invitation vise un nom (« whoever last spoke as bob ») ; le serveur l'apprend aussi du `&name=` des polls, que l'app n'envoyait pas jusqu'ici et enverra. Le poll de **Public** rend `dm: [{room, name, from, kind, at}]`. Pour `kind: "room"`, le site met la
room dans son carnet (`roomRemember`), et si `at` a moins d'une heure et que `room:at` n'a pas encore été vu, il ouvre
la room, sonne et dit « `<from>` opened "`<name>`" for you ». Les autres `kind` (DM) restent pour M2b-3.

**Carnet (rappel de M2b-1) :** créer ou rejoindre fait `roomRemember` (entrée en tête, `at` = maintenant, la clé gardée
si déjà connue, l'id retiré de `left`) ; quitter fait `roomForget` (entrée retirée, `left[id]` = maintenant). Chaque
changement demande une écriture de synchro (1,5 s plus tard).

**Renommer sans la clé :** `/rename` change le libellé local de la room (le carnet), et le site le dit : « renamed to
"X" for you (the room's maker or the owner renames it for everyone) ».

**Lien d'une room :** `https://gno.world/#r/<id>` (le site ajoute parfois `&ref=…` : ignoré).

## 4. Architecture

```
src/offchain/chat/
  identity-store.ts  NOUVEAU — zustand, unique par serveur : identity, setName, reserveName, onProofReply,
                     cancelProving, releaseName, setAvatar, identityError, proving, reloadIdentity
                     (déplacés tels quels depuis store.ts, avec leurs tests)
  store.ts           le log d'UNE room : boucle, loadOlder, send, edit, withdraw, react, vote, signalTyping,
                     markSeen ; + pin(id, on), deleteLine(id) quand la clé est là ; + `roomName` et `here` du poll
  client.ts          createChatClient(oc, identity, room) : `room=` / `X-Room` / `X-Room-Key` selon §3 ;
                     + pin, deleteLine, report ; le poll envoie `&name=` ; celui de Public expose `dm` (kind "room" seulement)
src/offchain/rooms/
  client.ts          make, info (→ room | 'gone'), listPublic, setRoom (name | public), dropRoom, invite, scan
  link.ts            parseRoomLink (lien gno.world `#r/<id>`, ou un id seul) ; roomLink(baseUrl, id)
  store.ts           zustand, le registre (§5)
src/state/app-services.tsx      crée l'identity store, le store de Public (room ''), le registre ; tout repart de zéro
                                au changement de serveur
src/app/(tabs)/chat.tsx         la liste (en-tête : ＋, ⇄ vers /pair)
src/app/room/[id].tsx           une room ; `public` pour Public
src/app/rooms/new.tsx           la feuille ＋ (form sheet)
src/screens/rooms/              list, new-sheet, room-menu (⋯), invite-sheet, banner
src/screens/chat/               ChatPane reçoit le store de la room et ses droits (clé) ; menu de ligne + Pin, Delete
scripts/fake-offchain/server.ts + les routes de §3, `room=` partout, `dm`, rooms disparues
e2e/rooms.e2e.test.ts
```

**Identité et rooms.** Chaque store de room reçoit `identity: () => ChatIdentity`, lu dans l'identity store au moment
d'écrire. La feuille d'identité et `/pair` lisent l'identity store ; `reloadIdentity()` (nom arrivé par `/pair`) y
passe.

**Ce qui est gardé, et où :**

| Donnée | Où |
|---|---|
| carnet (rooms, clés de créateur, `left`) | le `BookStore` de M2b-1, inchangé |
| marque de lecture d'une room | `br.chat.seen:<serveur>:<id>` (AsyncStorage) ; Public garde `br.chat.seen:<serveur>` |
| réactions et votes d'une room | `br.chat.marks:<serveur>:<id>` ; Public garde sa clé |
| invitations déjà vues (`room:at`) | en mémoire, comme le site |

Aucune migration : Public garde ses clés actuelles.

## 5. Le registre (`src/offchain/rooms/store.ts`)

**État :** `book` (le carnet chargé), `unread: {id: n}`, `invited: {id: from}` (« invited by bob », jusqu'à
l'ouverture), `banner` (la dernière invitation fraîche), `gone: {id: true}` (relevé tombé sur un 404), `error`.

**Stores de room :** créés à la demande par `room(id)`, au plus 8 gardés en mémoire (le moins récemment ouvert est
libéré : arrêté, oublié). `focus(id)` démarre le long-poll de cette room et arrête celui de la room précédente ;
`blur(id)` l'arrête. Public n'est jamais libéré et suit le premier plan comme aujourd'hui.

**Actions :**

- `open(id)` : `focus`, retire `invited[id]`, `unread[id] = 0`.
- `join(text)` : `parseRoomLink` (sinon « that is not a room link ») → `info(id)` ; trouvée : `remember({id, name})`,
  rend l'id ; `gone` : `forget(id)` et le message du site ; réseau : « the box did not answer about that room — try
  again in a moment ».
- `make(name, listed)` : `POST /api/room` → `remember({id, name, key})`, rend l'id (l'écran ouvre la room puis la
  feuille de partage du lien).
- `leave(id)` : arrête et libère le store, `forget(id)`.
- `rename(id, name)` : avec la clé, `POST /api/room {name}` puis `remember` ; sans, `remember` seul (libellé local) ;
  le message dit lequel (§3).
- `setListed(id, on)` : `POST /api/room {public}` avec la clé.
- `drop(id)` : `DELETE /api/room` avec la clé, puis `leave(id)`.
- `invite(id, to, tag)` : `POST /api/room/invite` avec la clé ; succès : « `<to>` gets "`<name>`" on their next poll ».
- `onDm(entries)` (appelé par le store de Public à chaque poll) : pour chaque `kind: "room"` à l'id valide,
  `remember({id: room, name})` ; si `at` a moins d'une heure et `room:at` n'est pas déjà vu : `invited[id] = from`,
  `banner = {id, name, from}`.
- `scanAll()` : pour chaque room du carnet sauf celle à l'écran, une à la fois, `scan(id, marque)` =
  `GET /api/chat?since=<marque>&wait=0&limit=200&room=<id>` ; `unread[id]` = lignes reçues moins celles que `isMine(l, you, mine)` reconnaît (`you` de
  la réponse, `mine` du store de la room s'il existe, sinon vide), comme le badge de M2a (la marque est celle du store de la room s'il existe, sinon celle stockée ; sans marque, 0 et la marque devient
  `next`). 404 : `gone[id] = true`, rien n'est effacé. Appelé quand la liste prend le focus, puis toutes les 2 min tant
  qu'elle est à l'écran.
- `remember` / `forget` suivent `roomRemember` / `roomForget` du site (§3), enregistrent le carnet et appellent
  `sync.changed()` ; le registre relit le carnet quand la synchro le change (rooms arrivées ou quittées ailleurs : une
  room quittée ailleurs ferme son store).

**Room disparue au poll :** le store de la room rend `gone` après trois 404 espacés de 20 s ; le registre fait
`forget(id)` et l'écran revient à la liste avec « "X" is gone — the room was quiet for a month ».

**Changement de serveur :** stores de room arrêtés et oubliés, carnet relu pour le nouveau serveur, une époque écarte
les réponses tardives (comme M2b-1).

## 6. Les écrans

**Liste (onglet Chat).** Public en tête, puis le carnet par `at` décroissant. Une ligne : nom, 🔑 si l'app tient la
clé, « invited by bob » le cas échéant, point et nombre de non-lus. Glisser à gauche : **Leave**. En-tête : ＋ (feuille
de §6), ⇄ (`/pair`, qui quitte l'en-tête du chat). Le badge de l'onglet devient le total des non-lus (Public compté
comme aujourd'hui, plus `unread` des rooms). Une bannière en haut de la liste ou de la room ouverte : « bob opened "X"
for you » avec **Open** et ×.

**Feuille ＋ (`rooms/new`).** Trois blocs, comme le menu ＋ du site :

1. **Make a room** — champ « a name for a new room » (120 caractères), interrupteur « List it publicly, for anyone to
   join », bouton Make.
2. **Join** — champ « or paste a room's link », bouton Join.
3. **Public rooms** — la liste de `/api/rooms` : nom, « N here » / « empty », « open » si déjà dans le carnet ; un champ
   de recherche à partir de 9 rooms ; « none right now — make one and list it » ; « could not be listed right now ».

**Room (`room/[id]`).** Le `ChatPane` de M2a avec le store de la room ; titre = nom de la room, sous-titre « N here ».
Menu ⋯ :

- **Share link** (feuille de partage du système, `roomLink`) ;
- **Invite…** (clé) — feuille : nom, tag facultatif de 4 hex (« with two bobs, add the four-letter tag ») ;
- **Rename** — avec la clé, pour tout le monde ; sans, libellé local ;
- **Listed / Unlisted** (clé) — l'état lu par `info(id)` ;
- **Delete room** (clé) — confirmation « Delete this room for everyone? It cannot be undone. » ;
- **Leave**.

Menu d'une ligne : en plus de M2a, **Pin / Unpin** et **Delete** (clé ; Delete avec confirmation).

**Public (`room/public`)** : le même écran avec le store de Public, sans menu ⋯ de room. Un lien
`gno.world://room/<id>` ouvre la room (Expo Router) ; une room inconnue passe par `join(id)`.

## 7. Erreurs

- Toute réponse refusée : le `error` du serveur mot pour mot, dans la room (zone d'erreur du composer) ou dans la
  feuille ; sans réponse : la phrase de M2a.
- 429 / 503 : attendre `Retry-After`, comme le chat.
- Une action de créateur sans clé n'est pas proposée ; si le serveur refuse la clé (clé remplacée ailleurs par
  `/claim`), son message s'affiche et l'entrée garde sa clé (le site fait de même).
- Le relevé ne montre jamais d'erreur : une room injoignable garde son compteur.

## 8. Faux serveur

`scripts/fake-offchain/server.ts` gagne, d'après §3 : des logs par room (`room=` sur toutes les routes du chat, `X-Room`
pour react et vote), `POST/GET/DELETE /api/room`, `GET /api/rooms`, `POST /api/room/invite` (l'invité reçoit l'entrée
`dm` sur le poll de Public de qui a parlé sous ce nom en dernier), pin et retrait de ligne avec `X-Room-Key`, `name` et
`here` dans le poll d'une room, et une commande de test qui fait disparaître une room (404 partout). Les messages
d'erreur sont ceux du site.

## 9. Tests

- **Unitaires (jest) :** `client.ts` du chat (où va `room=`, `X-Room`, `X-Room-Key` pour chaque action ; `dm` filtré) ;
  `rooms/client.ts` ; `link.ts` ; le registre avec un faux client (open, join trouvé / disparu / réseau, make, leave et
  `left`, rename avec et sans clé, setListed, drop, invite, `onDm` frais / ancien / déjà vu, `scanAll` et ses marques,
  plafond de 8 stores, room disparue, changement de serveur, carnet changé par la synchro) ; le store d'une room (pin,
  deleteLine, `gone` après trois 404, marques par room) ; l'identity store (tests déplacés depuis le store du chat) ;
  les écrans (liste, feuille ＋, menu ⋯, bannière).
- **E2e (`npm run e2e:rooms`) :** les stores de l'app contre le faux serveur, avec un second client : créer puis
  rejoindre par le lien, lignes dans les deux sens ; invitation reçue ; outils du créateur ; quitter ; avec
  `scripts/fake-offchain/site-sync.ts`, la room créée et la room quittée passent au navigateur par `/pair`.
- **Manuel :** simulateur iOS 26.5 et émulateur Android contre le faux serveur ; puis la production : `/api/rooms` lu,
  « Dev chat » ouverte sans écrire, et une room privée créée pour l'occasion (créer, écrire, épingler, supprimer la
  room).

## 10. Décisions

- Outils du créateur dans M2b-2 ; `/claim` et le pont IRC attendent (choix A du 2026-10-13).
- Onglet Chat = liste des conversations, une room en plein écran (choix du 2026-10-13).
- Long-poll pour Public et la room à l'écran seulement ; les autres rooms par relevé (choix du 2026-10-13).
- Un store par room et un identity store à part (approche 1 du 2026-10-13).
