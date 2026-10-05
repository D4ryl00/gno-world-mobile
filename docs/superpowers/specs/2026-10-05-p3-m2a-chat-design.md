# P3-M2a : chat principal — design

Premier des quatre jalons de P3-M2 (social, off-chain), décidés le 2026-10-05 : M2a chat principal,
M2b rooms, DM et amis, M2c pièces jointes et vocaux, M2d appairage avec le navigateur et présence
« people here ». Spec parente : `2026-10-01-bubblerumble-mobile-design.md` (§5.4, §5.5, §5.6).

## 1. Objectif

Lire et écrire dans le chat principal de bubblerumble.net depuis l'app, sous un nom (réservable) et
avec un avatar, comme sur le site. Le serveur off-chain ne gêne jamais le jeu.

**Critères de réussite :**

1. Les lignes du chat principal arrivent en direct (long-polling), et l'historique se remonte.
2. Poster, répondre, éditer sa ligne, reprendre sa dernière ligne, réagir et voter fonctionnent
   contre le faux serveur, et la lecture fonctionne contre la production.
3. Un nom se réserve par la même séquence que le site ; un avatar se choisit et accompagne les lignes.
4. Une panne du serveur affiche « server unreachable » et rien d'autre ne change dans l'app.

## 2. Périmètre

**Dans M2a :**

- lecture du chat principal : long-polling, historique en remontant, lignes éditées et supprimées,
  lignes du bot du site (🤖), épingles (lecture), « en train d'écrire », nombre de présents ;
- écriture : poster, répondre à une ligne, éditer sa ligne (moins de 15 min), reprendre sa dernière
  ligne (la plus récente du chat, à soi, moins de 15 min), réactions 👍 🔥 ❤️ 😂 👎 (bascule), vote
  dans un sondage existant ;
- nom libre, et réservation (✓) par la séquence du site, avec le rapport de boop ;
- avatar : choisir une photo, l'envoyer ;
- badge de lignes non lues sur l'onglet Chat.

**Ailleurs :**

- M2c : afficher et envoyer images, fichiers et vocaux ; signaler (le site ne signale que les images
  et fichiers) ; partager une image. En M2a, ces lignes montrent « 📎 picture », « 📎 file » ou
  « 🎤 voice message » ;
- M2b : rooms, DM, amis, notes sur une personne (le menu « ▾ » d'un nom) ;
- jamais : commandes `/…`, traduction (API du navigateur), création de sondage (commande sur le
  site), suggestion d'épingle, outils du propriétaire, pont IRC.

**Correction du §5.4 de la spec parente :** `/api/profile` n'est pas un profil d'utilisateur mais un
rapport de performance (« fps · frame gaps … sent as profile #id »). Le « profil » se résume au nom
et à l'avatar.

## 3. Le protocole du site

Lu dans le JS public de bubblerumble.net le 2026-10-05 (pas de code serveur publié, pas de serveur
de test). En cas de doute, le comportement du site fait foi (spec parente §5.5).

**Lecture :** `GET /api/chat?since=<id>&wait=<s>&limit=<n>[&gen=<g>]`.

- premier appel `since=0&wait=0&limit=80`, puis `since=<curseur>&wait=55&limit=200&gen=<g>` ;
- historique : `before=<id>&limit=100` ;
- réponse : `msgs`, `gone` (ids supprimés), `upd` (lignes modifiées), `next` (curseur), `gen` (un
  changement veut dire que le serveur a repris son journal : on recharge), `pins`, `typing`, `here`,
  `who`, `you` (`{cc, tag}`), `now`, `build`, et d'autres champs ignorés ici (`news`, `voice`,
  `reload`, `reloadAt`, `dm`) ;
- 429 ou 503 : attendre `Retry-After` (6 s par défaut) plus un délai aléatoire.

**Une ligne :** `id`, `t`, `name`, `tag` (tourne chaque jour), `cc`, `body`, `re` (`{id, name,
body}`), `rx` (emoji → nombre), `rxwho`, `ed` (éditée), `pinned`, `v` (nom réservé), `av`, `bot`,
`poll` (`{q, opts, …}`), `att`, `clip`, `dur`, `pos`. Une ligne est « à soi » si son `tag` est celui
de `you`, ou si l'app l'a postée.

**Écriture :**

| Action | Requête |
|---|---|
| poster | `POST /api/chat` `{name, body, re?, av?, avkey?}` → `{msg}` |
| éditer | `PATCH /api/chat?id=<id>` `{body}` → `{msg}` |
| reprendre sa dernière ligne | `POST /api/chat/withdraw` → `{deleted}` |
| réagir | `POST /api/chat/react` `{id, emoji, name}` → `rx`, `rxwho` |
| voter | `POST /api/chat/vote` `{id, opt}` → `{mine, poll}` |
| en train d'écrire | `POST /api/chat/typing` `{name, n}` (n = 0 pour effacer), 3 s au plus |
| réserver un nom | `POST /api/name` `{name}` → `{name, key, addr}` ; `GET /api/name?name=` ; `DELETE /api/name` |
| avatar | `POST /api/avatar` (octets de l'image, `Content-Type` de l'image) → `{id, key}` ; image `GET /api/avatar/<id>.jpg` |
| rapport de boop | `POST /api/bubble/boop` `{addr, pool, n, v}`, dans les 10 min du boop |

**En-têtes :** `X-Bid` (16 hex, déjà en place), `X-Name-Key` (la clé du nom réservé), avec le
rapport de boop, la réservation et l'écriture.

**Réservation du nom :** le site exige un wallet connecté et dit « one boop does it », mais la
requête ne porte ni adresse, ni `X-Bid`, ni cookie. Hypothèse retenue : le serveur lie l'adresse au
client par le rapport de boop, qu'il peut vérifier sur la chaîne. Le faux serveur suit cette
hypothèse ; la seule vérification réelle est faite par l'utilisateur, une fois, en réservant son nom
sur la production. Si elle échoue, le nom libre reste, et la réservation passe au jalon suivant.

## 4. Architecture

```
src/offchain/
  http.ts            existant ; ajoute X-Name-Key, un corps en octets (avatar) et un délai par requête
  chat/
    types.ts         ChatLine, Pin, Poll, ChatSnapshot
    parse.ts         réponse du serveur → types, tolérant (champ inconnu ignoré, champ absent → défaut)
    merge.ts         pur : applique une réponse à l'état
    client.ts        poll, older, post, edit, withdraw, react, vote, typing, name, avatar, boop
    store.ts         zustand : état, boucle de long-polling, actions
    identity.ts      nom, clé du nom, avatar (id, clé) dans SecureStore
src/screens/chat/    écran, ligne, composeur, feuille nom et avatar
src/app/(tabs)/chat.tsx   quatrième onglet, entre Pools et Session
scripts/fake-offchain/    serveur Node en mémoire (TypeScript exécuté par Node 22)
```

**La boucle** (`store.ts`, démarrée et arrêtée par `app-services.tsx` avec le premier plan, comme la
présence) :

1. premier appel `wait=0&limit=80` ;
2. ensuite `since=<curseur>&wait=55&gen=<g>`, délai maximal 70 s ;
3. `gen` changé : on recharge depuis le début ;
4. 429 ou 503 : `Retry-After` plus un délai aléatoire ; erreur réseau : nouvel essai avec un délai
   croissant, et l'état « server unreachable » ;
5. changement de réseau ou d'URL du serveur : la boucle repart de zéro.

**Les actions** passent par `client.ts` et mettent le store à jour dès la réponse (`msg`, `poll`,
`rx`), sans attendre le poll suivant. Après chaque boop réussi dans l'app (`GameClient.bid`), le
rapport de boop part, comme sur le site.

**Non lues :** le dernier id vu est gardé dans AsyncStorage ; le badge compte les lignes au-dessus,
hors de l'onglet Chat.

**Dépendance nouvelle :** `expo-image-picker` (module natif : nouveau dev build), installée par
`npx expo install`.

## 5. L'écran Chat

- **En-tête :** « Chat · 26 here », bouton « you » (feuille nom et avatar), bandeau « server
  unreachable » quand la boucle échoue.
- **Épingles :** bandeau avec la première, déplié au toucher ; toucher une épingle remonte à sa
  ligne si elle est chargée.
- **Lignes** (`FlatList` inversée ; en remontant, `before=`) : avatar, drapeau, nom, ✓ si réservé,
  `·tag`, heure relative, « edited », 🤖 ; ligne citée d'une réponse (toucher y saute) ; liens
  touchables, ouverts dans le navigateur ; réactions avec compteurs, les siennes en relief ;
  sondage : options en barres, toucher pour voter ; images, fichiers et vocaux : texte de
  remplacement.
- **Appui long sur une ligne :** répondre, réagir ; sur les siennes de moins de 15 min, éditer, et
  « take back » si c'est la plus récente du chat.
- **Composeur :** champ multi-ligne, bandeau « replying to … » ou « editing your line » avec ✕,
  envoyer ; « X is typing… » au-dessus.
- **Premier envoi sans nom :** la feuille du nom s'ouvre d'abord, « anon » proposé.
- **Feuille nom et avatar :** champ du nom ; « Reserve this name », actif avec une session (l'adresse
  maître est le compte), qui dit qu'un boop depuis l'app est nécessaire et montre tel quel un refus
  du serveur ; une fois réservé, « ✓ yours » et « Release » ; « Choose a photo » (sélecteur, recadrage
  carré, envoi).
- **Badge** de non lues sur l'onglet.

## 6. Faux serveur

`scripts/fake-offchain/`, lancé par `npm run fake-offchain` (port 8787) et par les tests
d'intégration.

- les points d'entrée de M2a et leurs règles : édition de sa ligne à moins de 15 min ; reprise de la
  plus récente si elle est à soi et a moins de 15 min ; réaction en bascule ; un vote par sondage,
  modifiable ; « en train d'écrire » qui expire en quelques secondes ; long-poll qui répond dès
  qu'il se passe quelque chose ou au bout de `wait` ;
- « à soi » : même `X-Bid` (ou même clé de nom) que l'auteur ; `tag` dérivé de `X-Bid` ;
- réservation selon l'hypothèse du §3 : un rapport de boop lie l'adresse au client (`X-Bid`), puis
  `POST /api/name` réserve pour cette adresse ; les noms déjà pris ou proches sont refusés ;
- avatars en mémoire ;
- contenu de départ : quelques lignes, une épingle, un sondage, une ligne du bot, une réponse ;
- routes de test (`/__test/…`) : faire parler « quelqu'un d'autre », changer `gen`, renvoyer un 429
  ou un 503 ;
- simulateur : Réglages → serveur off-chain `http://127.0.0.1:8787` (Android : `adb reverse`).

## 7. Erreurs

- échec de la boucle : bandeau « server unreachable », nouvel essai avec délai croissant ; le jeu et
  le reste de l'app ne changent pas ;
- action refusée : le texte du serveur dans le composeur, et le texte tapé est gardé ;
- champ ou type de ligne inconnu : texte de remplacement, jamais de plantage.

## 8. Tests

- **Unitaires (jest) :** parseur sur des réponses enregistrées en production (GET seulement) ;
  `merge` (nouvelles lignes, `upd`, `gone`, reprise de `gen`, épingles, typing) ; boucle avec un faux
  `fetch` (délai croissant, `Retry-After`, `gen`, redémarrage au changement d'URL) ; forme exacte de
  chaque requête (en-têtes, corps) ; identité dans SecureStore ; compte des non lues.
- **Intégration (`npm run e2e`) :** le vrai client et le vrai store de l'app contre le faux serveur ;
  deux clients (l'un poste, l'autre reçoit par le long-poll) ; répondre, éditer, reprendre, réagir,
  voter, typing ; rapport de boop puis réservation ; avatar envoyé puis `av` sur la ligne.
- **Fidélité du faux serveur :** ses réponses passent par le même parseur que les enregistrements de
  production, et un test vérifie qu'elles ont les mêmes clés et les mêmes types.
- **Manuel :** simulateur iOS contre le faux serveur, toutes les actions ; production : lecture
  seule, plus la réservation de son nom par l'utilisateur. Poster sur la production attend la room
  privée de M2b (l'utilisateur peut poster une ligne dans le chat principal s'il le veut).

## 9. Décisions

- Réservation du nom : séquence du site, hypothèse dans le faux serveur, une vérification réelle
  par l'utilisateur (choix du 2026-10-05).
- Le chat est un quatrième onglet (choix du 2026-10-05) ; les rooms de M2b y entreront.
- La boucle vit dans un store, tant que l'app est au premier plan, comme sur le site (choix du
  2026-10-05) ; pas de second mécanisme pour le badge.
- Aucun POST vers la production dans les tests automatiques (spec parente §5.7).
