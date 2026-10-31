# Onglets de canaux (Home et Chat), rooms complètes, « New pool » sans session — design

Brainstorming du 2026-10-30. Ce document **reprend tout M2b-2** (`2026-10-13-p3-m2b2-rooms-design.md`, jamais
construit) et en **remplace les écrans** : plus de liste de conversations, une rangée d'onglets de canaux dans l'onglet
Chat et dans la carte chat de Home. Le protocole (§3), l'architecture des stores (§4, hors routes d'écran), le registre
(§5), les erreurs (§7), le faux serveur (§8) et les tests (§9) de M2b-2 restent valables tels quels sauf ce qui est dit
ici. S'y ajoute un petit changement dans l'onglet Pools.

Maquettes validées le 2026-10-30 : `.superpowers/brainstorm/48809-1793361504/content/channels-v2.html` (git-ignoré).

« Canal » = Public ou une room du site (§3 de M2b-2). Les deux mots désignent la même chose dans ce document.

## 1. Pourquoi

- Dans Home, la carte chat ne dit pas quel canal on lit, et on ne peut pas en changer.
- L'app ne connaît que Public : les rooms de gno.world (celles du navigateur appairé, les rooms listées) sont
  invisibles.
- Dans Pools, « New pool » s'ouvre sans session, et on ne découvre qu'au bas du formulaire qu'il en faut une, sans
  chemin vers l'onglet Session.

## 2. Objectifs, non-objectifs

**Objectifs (décidés par l'utilisateur) :**

1. Home : la carte chat montre une rangée d'onglets de canaux ; par défaut seulement **Public**. En plein écran, on
   **ajoute** des onglets parmi les rooms accessibles ; un onglet ajouté apparaît aussi dans la rangée de la carte.
   Les noms trop longs sont coupés.
2. Le canal affiché dans Home est indépendant de celui de l'onglet Chat, **sauf** « Write in … » qui ouvre l'onglet
   Chat sur le canal qu'on lisait.
3. Onglet Chat : la même rangée d'onglets, mais **déjà remplie** : Public, puis les rooms rejointes, puis les rooms
   listées publiquement sur gno.world (non rejointes). On n'ajoute rien à la main.
4. Tout M2b-2 est dans ce tour : lire et écrire dans une room, créer, rejoindre par lien, quitter, inviter, recevoir
   une invitation, outils du créateur (renommer, lister, épingler, retirer une ligne, supprimer la room).
5. Pools sans session : « New pool » est **désactivé** (pas cliquable) et l'utilisateur est guidé vers l'onglet
   Session.

**Non-objectifs :** ce que M2b-2 laissait déjà dehors (`/claim`, pont IRC, DM et autres `kind` de `dm`, pièces
jointes et voix, présence détaillée, universal links `https://gno.world/#r/…`).

**Anti-objectifs :** plus de deux long-polls ouverts à la fois ; un canal affiché dans Home qui change parce qu'on a
changé de canal dans Chat (ou l'inverse) ; un bouton « New pool » qui mène à un formulaire inutilisable.

## 3. La rangée d'onglets (composant partagé)

Un composant `ChannelTabs` (dans `src/screens/channels/`) : rangée horizontale défilante de pastilles, une par canal.

- Pastille : nom du canal sur une ligne, coupé par une ellipse au-delà d'environ 12 caractères (largeur max fixe) ;
  pastille courante soulignée de la couleur d'accent ; 🔑 devant le nom quand l'app tient la clé de créateur ; nombre
  de non-lus en pastille rouge (Public et rooms rejointes seulement — §5).
- Toucher une pastille change le canal courant de **cet écran-là**. La pastille courante défile pour rester visible.
- Accessibilité : chaque pastille est un `tab` avec `selected` ; libellé « Dev chat, 3 unread ».
- Variantes : `separator` (un filet vertical entre rooms rejointes et rooms listées, onglet Chat seulement) ; `onAdd`
  (une pastille ＋ en pointillé en fin de rangée, plein écran de Home seulement) ; `onLongPress` (retirer, Home
  seulement).

## 4. Home

**Les onglets de Home** : une liste ordonnée de canaux `{id, name}` choisie par l'utilisateur, Public toujours en
premier et non retirable, plus le canal courant de Home. Gardés dans AsyncStorage sous
`br.home.channels:<serveur>` (`{tabs: [{id, name}], current: id}` ; Public = id `''`). Premier lancement ou clé
illisible : `{tabs: [Public], current: ''}`. Changement de serveur : on relit la clé de ce serveur.

**Carte chat** (`src/screens/home/chat-card.tsx`) : l'en-tête `CHAT ›` garde sa place ; la rangée d'onglets passe
dessous ; les lignes sont celles du canal courant de Home. Toucher une pastille change de canal sans ouvrir le plein
écran ; toucher le reste de la carte ouvre le plein écran sur ce canal. Le libellé d'accessibilité de la carte nomme le
canal (« Chat, Dev chat. jae: … »).

**Plein écran** (`src/screens/home/full/chat-full.tsx`, route `home/chat`) : la rangée d'onglets sous l'en-tête, avec la
pastille ＋ en fin. Changer d'onglet ici change aussi le canal courant de Home (c'est le même réglage). Le pied
devient « Write in <nom du canal> › » (nom coupé) : il ferme le plein écran et ouvre l'onglet Chat **sur ce canal**
(`router.dismissTo({pathname: '/chat', params: {room: id}})`, Public = `room` absent ou vide).

**Sélecteur « Show on Home »** (feuille ouverte par ＋) : deux sections, « YOUR ROOMS » (les rooms rejointes, ordre
du carnet) et « LISTED ON GNO.WORLD » (`/api/rooms` moins les rejointes) ; chaque ligne a ✓ si elle est déjà un onglet,
sinon ＋. Toucher une ligne l'ajoute (en fin de rangée, et elle devient le canal courant) ou la retire. « could not be
listed right now » si `/api/rooms` échoue (la section rooms rejointes reste). Ajouter une room listée ne la rejoint
pas.

**Retirer** : appui long sur une pastille (sauf Public) → menu « Remove from Home ». Retirer le canal courant ramène à
Public.

**Un onglet de Home qui n'existe plus** : room quittée qui n'est plus listée, ou room disparue (404) → l'onglet est
retiré au prochain rendu, le canal courant retombe sur Public, sans message dans Home (le message de disparition est
dit dans Chat, comme dans M2b-2 §5).

**Lecture seule** : Home ne fait toujours rien écrire, réagir ni voter ; la lecture marque comme lu (comme
aujourd'hui pour Public, désormais par canal).

## 5. Onglet Chat

**Rangée** : Public ; les rooms rejointes (le carnet, `at` décroissant — l'ordre du navigateur) ; le filet ; les rooms
de `/api/rooms` absentes du carnet, dans un **ordre stable** : par `made` croissant (puis par id), pas l'ordre de la
réponse, qui suit `here` et ferait sauter les pastilles à chaque relecture. Des noms en double existent en production
(« Patus World » ×2) : dans le sélecteur de Home et la feuille ＋, chaque ligne montre « N here » à côté du nom ; dans la
rangée, deux pastilles de même nom gardent simplement leur place stable.

**Relevés** : le registre relit `/api/rooms` et fait le relevé des non-lus des rooms rejointes (`scanAll`, M2b-2 §5)
**tant que l'app est au premier plan**, toutes les 2 min, quel que soit l'onglet affiché (les pastilles de Home et le
badge de Chat en dépendent), et en plus tout de suite quand l'onglet Chat ou le sélecteur « Show on Home » s'ouvre
(pas plus d'une fois par 10 s). Le relevé reste une room à la fois, en `wait=0`. Non-lus : Public comme aujourd'hui,
rooms rejointes par ce relevé ; les rooms listées non rejointes n'ont pas de compteur (pas de marque de lecture, pas de
relevé). Le badge de l'onglet Chat = total Public + rooms rejointes. Un onglet de Home n'est retiré pour cause de room
non listée qu'une fois une liste `/api/rooms` effectivement reçue (une erreur ne retire rien).

**Canal courant de Chat** : à lui seul, gardé dans AsyncStorage `br.chat.current:<serveur>`. Le paramètre `room` de la
route (venu de « Write in … », d'une invitation ou d'un lien) le remplace puis est effacé (comme `identity` aujourd'hui).
Un canal courant absent de la rangée (quitté, disparu) retombe sur Public.

**En-tête** : à gauche « Chat · N here » (le `here` du canal courant, comme aujourd'hui pour Public) ; à droite la
pastille du nom (inchangée : elle ouvre la feuille d'identité, que `chat?identity=1` rouvre aussi au retour du wallet),
＋ (feuille de M2b-2 §6 : Make a room, Join par lien, Public rooms), ⋯. Le menu ⋯ existe pour tous les canaux : il
commence par les entrées de la room courante (M2b-2 §6 ; aucune sur Public) et finit par « Pair with a browser »
(`/pair`), qui quitte l'en-tête pour faire de la place.

**Sous la rangée** : la bannière d'invitation de M2b-2 (« bob opened "X" for you », Open → ce canal devient le canal
courant de Chat, × la ferme) ; puis le `ChatPane` de M2b-2 avec le store du canal courant et ses droits ; le placeholder
du composer nomme le canal (« say something in Dev chat »).

**Room listée non rejointe** : on la lit sans la rejoindre. **Écrire sa première ligne** (envoi réussi) la rejoint
(`remember`) : elle passe dans le groupe des rooms rejointes. *(Proposé pendant le brainstorming, non contesté.)*

**Créer, rejoindre par lien, ouvrir une invitation** : la room devient le canal courant de Chat (au lieu d'ouvrir un
écran `room/[id]`). Après « Make », la feuille de partage du lien s'ouvre comme dans M2b-2.

**Lien profond** : `gno.world://chat?room=<id>` ouvre l'onglet Chat sur la room ; une room inconnue passe par
`join(id)` (M2b-2 §5). Pas de route `room/[id]` ni `room/public`.

**Room disparue** (trois 404 au poll, M2b-2 §5) : retirée du carnet, le canal courant retombe sur Public, et « "X" is
gone — the room was quiet for a month » s'affiche au-dessus du chat (fermable).

## 6. Long-polls

Au plus deux à la fois, comme M2b-2 critère 5 : **Public** (toujours au premier plan, comme aujourd'hui — c'est lui qui
porte `dm` et le compteur de Public) et **la room à l'écran**, c'est-à-dire, selon l'écran qui a le focus : le canal
courant de l'onglet Chat, le canal courant de Home (carte ou plein écran). Changer de canal ou d'écran fait `blur` de
l'ancienne room et `focus` de la nouvelle (registre de M2b-2 §5). Quand le canal à l'écran est Public, il n'y a qu'un
long-poll. Au retour sur un écran, la room y reprend depuis sa marque (comme le registre le fait déjà).

## 7. Pools sans session

Dans `src/screens/pools/index.tsx`, sans session active (`useSession((s) => s.active)` nul) et hors pays bloqué :

- « New pool » s'affiche **désactivé** (`disabled`, opacité réduite, pas d'action) ;
- dessous, une ligne en gris : « A session lets this phone play. Start one to create a pool. » ;
- dessous, un bouton secondaire « Go to Session › » → `router.navigate('/session')`.

Avec une session : inchangé. Pays bloqué : inchangé (`NOPLAY_TEXT`, prioritaire). L'écran `create` garde son garde-fou
actuel (bouton « set up a session first » désactivé) pour un lien profond qui l'ouvrirait sans session.

## 8. Ce qui change dans l'architecture de M2b-2 (§4)

| M2b-2 | Ici |
|---|---|
| `src/app/(tabs)/chat.tsx` = la liste | l'onglet Chat = rangée + canal courant (§5) |
| `src/app/room/[id].tsx` | supprimé ; `chat?room=<id>` |
| `src/app/rooms/new.tsx` (feuille ＋) | gardé |
| `src/screens/rooms/` list | remplacé par `src/screens/channels/` : `channel-tabs.tsx`, `home-channels.ts` (store des onglets de Home, §4), `chat-channels.ts` (rangée de Chat : carnet + listées, canal courant) ; `new-sheet`, `room-menu`, `invite-sheet`, `banner` restent dans `src/screens/rooms/` |
| registre : `focus`/`blur` par l'écran room | appelés par l'écran qui a le focus (§6) |
| rien sur Home | carte et plein écran par canal (§4) ; `ChatFull` reçoit le store du canal |

Les rooms listées (`listPublic`, M2b-2 `rooms/client.ts`) sont gardées dans le registre (`listed`, `listedError`) pour
que Home et Chat lisent la même liste.

## 9. Tests

En plus de M2b-2 §9 (qui ne parle plus de l'écran liste) :

- `ChannelTabs` : coupe des noms, pastille courante, non-lus, filet, ＋, appui long.
- Onglets de Home : défaut Public, ajout/retrait, Public non retirable, persistance par serveur, onglet disparu →
  Public, indépendance avec le canal de Chat, « Write in … » qui ouvre Chat sur le bon canal.
- Rangée de Chat : ordre (Public, carnet, listées moins carnet), paramètre `room`, persistance, première ligne dans une
  room listée → rejointe, canal disparu → Public.
- Long-polls : jamais plus de deux ouverts en passant de Home à Chat et entre canaux.
- Pools : sans session, bouton désactivé + « Go to Session › » qui navigue vers `/session` ; avec session, inchangé ;
  pays bloqué, inchangé.
- Manuel : simulateur iOS et émulateur Android contre le faux serveur, puis la production comme M2b-2 §9.

## 10. Décisions

**De l'utilisateur (2026-10-30) :** onglets plutôt que liste de conversations ; Home = Public par défaut + onglets
ajoutés en plein écran parmi les rooms accessibles ; canal de Home indépendant de Chat sauf « Write in … » ; rangée de
Chat pré-remplie, rooms rejointes puis rooms listées ; tout M2b-2 dans ce tour ; « New pool » désactivé sans session et
guidage vers Session ; maquettes validées.

**Les miens (à contester) :** pastilles arrondies ; filet entre rejointes et listées ; non-lus sur les pastilles,
absents pour les listées non rejointes ; ＋ et ⋯ dans l'en-tête de Chat ; bannière d'invitation au-dessus des lignes ;
appui long pour retirer un onglet de Home ; onglets de Home et canal de Chat gardés par serveur ; première ligne dans
une room listée = la rejoindre ; en-tête de Chat = « Chat · N here », pastille du nom, ＋, ⋯ (⇄ `/pair` passe dans
⋯) ; relevés pilotés par le registre au premier plan toutes les 2 min (pas seulement sur l'onglet Chat) ; rooms
listées en ordre stable par `made`, « N here » dans le sélecteur et la feuille ＋ ; textes de Pools (« A session lets this phone play… », « Go to Session › ») ; lien
profond `chat?room=` au lieu de `room/<id>`.
