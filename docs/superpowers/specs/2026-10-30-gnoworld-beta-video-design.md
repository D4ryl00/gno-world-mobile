# Vidéo « what's new + bêta » de gno.world — design

**Statut :** conçu le 2026-10-30 ; l'utilisateur a demandé de faire la vidéo dans la foulée, sans autre question.
Les choix marqués *(choix de Claude)* sont à relire.

**Livré le 2026-10-30** (plan `docs/superpowers/plans/2026-10-30-gnoworld-beta-video.md`) : `DEMO=beta npm run demo`
rend 79,3 s, `demo:check` vert. Écarts : un nom de chat (« demo ») posé hors caméra (sans nom, le premier message
ouvre la feuille du nom) ; une ligne « welcome, gno devs! » dans le salon ; les lignes des cartes passent de 32 à 40 px.
Revu le 2026-10-31 avec l'utilisateur : plus aucun zoom (un zoom dans le téléphone coupait chaque ligne à droite) ; pas
de flou (le chat Public est public) ; pas de feuille de partage ni de message tapé. Les salons deviennent deux scènes :
`rooms` (Public, puis les onglets Dev chat et $GNOT price chat, puis « New room », le nom, Make — la coupe tombe avant la
feuille de partage, qui met plus de 3 s à s'ouvrir) et `tools` (le salon ouvert, son menu de créateur).

Une deuxième vidéo, produite par commande comme la première (`docs/superpowers/specs/2026-10-13-gnoworld-demo-video-design.md`,
pipeline `demo/`), qui montre aux devs gno **ce qui a changé depuis la démo du 13 octobre** et les **invite à rejoindre la
bêta** (TestFlight, Google Play internal testing), avec la feuille de route.

## 1. Intention

L'app est sur TestFlight et Play internal testing. On veut des testeurs parmi les devs gno, tout de suite, même si l'app
n'est ni parfaite ni finie. La vidéo montre l'app telle qu'un testeur l'installe (le build des stores, sans
gnokey-mobile), sur le vrai gno.world, puis dit comment entrer dans la bêta et ce qui vient ensuite.

**Décidé par l'utilisateur (2026-10-30) :**

- Public : les devs gno.
- Appel à l'action : demander à rejoindre TestFlight / Play internal testing **par e-mail à remi@berty.tech**.
- Feuille de route à montrer : interactions avec le wallet gnokey-mobile, notifications push.
- Filmé sur le **vrai gno.world** (serveur https://gno.world, gno.land mainnet), pas sur la chaîne locale.
- **Pas de jeu filmé** (pas de session accordée, pas de boop : ce seraient de vrais GNOT sur mainnet).
- Pas de conversation à deux dans la scène des salons.
- Partir de cette branche (`feat/channel-tabs`, PR #4) comme si elle était sur `main`.

**Critères de réussite :**

1. `DEMO=beta npm run demo` produit `demo/out-beta/gnoworld-beta.mp4` (1920×1080, 30 i/s, voix off anglaise) sans
   intervention, et `demo:check` passe (durée 60–110 s).
2. Les plans de l'app sont réels : le build Release **sans wallet** (`EXPO_PUBLIC_WALLET=off`, comme le profil
   `production` d'eas.json) sur le simulateur iOS, contre la production.
3. Aucun code ajouté à l'app pour la vidéo.
4. La première démo garde ses fichiers et son comportement (`npm run demo` sans `DEMO` = `script.ts`, `out/`).
5. Rien ne reste sur gno.world après la prise (le salon filmé est supprimé, hors caméra).

**Hors sujet :** Android à l'écran *(choix de Claude : la voix dit que l'app est sur les deux stores ; filmer Android
demanderait un second pipeline de capture)* ; le jeu ; le nom prouvé ; la diffusion (rendu local, l'utilisateur publie).

**Anti-objectifs :** promettre une app finie (la vidéo dit « early beta ») ; montrer un message de chat inconvenant
d'un vrai utilisateur ; laisser un salon de démo sur gno.world.

## 2. Ce qui est nouveau depuis le 13 octobre (relevé dans git)

- **Home** (PR #2, `53a6206`) : prix du GNOT (graphique 1d/7d/30d), qui est là par pays, aperçu du chat ; chaque carte
  s'ouvre en plein écran (graphique avec réticule sous le doigt et volumes, carte du monde + tableau, chat en lecture).
- **Onglets de canaux et salons** (PR #4) : Public et les salons en onglets, sur la carte chat de Home et dans l'onglet
  Chat ; faire un salon (non listé ou listé), le rejoindre par lien, le partager ; outils du créateur (Invite…, Rename,
  épingler une ligne, Delete room).
- **Build des stores sans wallet** (PR #3) : l'onglet Session montre « Coming soon — gnokey mobile » et donne une
  commande `gnokey` à lancer sur l'ordinateur ; New pool demande une session et renvoie vers l'onglet Session.
- Coulisses (pas à l'écran) : Expo SDK 58, pipeline semantic-release → EAS → TestFlight / Play.

## 3. Scénario

Textes de voix provisoires *(choix de Claude)*, à corriger à la relecture du rendu. Les adresses e-mail sont écrites
en toutes lettres pour Kokoro (« remi at berty dot tech »), en clair sur les cartes.

| # | À l'écran | Voix off | Sous-titres |
|---|---|---|---|
| 0 `title` | Carte : logo, « gno.world », « what's new · beta » | Two weeks ago we showed gno.world on a local chain. Here is what's new, filmed on the real gno.world, and how to try it yourself. | — |
| 1 `home` | Home au lancement ; carte prix → plein écran, glisser le réticule, retour ; carte « here now » → carte du monde, retour | The app now opens on Home: the GNOT price, who is here right now, and the latest chat. Every card opens full screen: the chart, with a crosshair under your finger, and a map of who's around. | Home: price, people, chat / Every card opens full screen |
| 2 `rooms` | Onglet Chat (Public en onglet) ; ＋ → « Make a room », nom tapé, non listé, Make → feuille de partage iOS avec le lien, fermée ; l'onglet du salon ; menu du salon (Invite…, Rename, Delete room), fermé | Chat has channels now. Public is one tab, and anyone can make a room: give it a name, keep it unlisted, and share the link. The maker gets the tools: invite by name, rename, pin a line, or delete the room. | Channels: Public and your rooms / Make a room, share the link |
| 3 `session` | Onglet Session : carte « Coming soon — gnokey mobile » ; « Get a session from a computer » → « Run this on your computer » et la commande gnokey | Playing needs a session key. gnokey-mobile is not in the stores yet, so for now the app gives you one gnokey command to run on your computer. Your account authorises the phone's key once, with a budget and an expiry. | gnokey-mobile: coming soon / A session from your computer, today |
| 4 `join` | Carte : « Join the beta », « remi@berty.tech » (vert), « TestFlight (iPhone) · Google Play internal testing (Android) », « Send your Apple ID or Google account email » | gno.world is now on TestFlight and Google Play internal testing. It is an early beta, with rough edges. To join, email remi at berty dot tech with your Apple ID or Google account address, and say iPhone or Android. | — |
| 5 `next` | Carte : « Next », « gnokey-mobile in the app: sessions and name proofs from your phone », « Push notifications », « Early beta · filmed on gno.world » | Next: gnokey-mobile inside the app, so sessions and name proofs happen on your phone, without a computer. And push notifications, so you never miss a pool or a message. | — |

Durée visée : ~75 s.

**Le salon filmé** *(choix de Claude)* : nommé « gno devs », non listé (interrupteur laissé éteint). Son lien apparaît
dans la feuille de partage ; il est supprimé hors caméra après la prise (« Delete room » dans son menu), donc le lien
de la vidéo ne mène nulle part.

**Le chat réel** : Home et l'onglet Chat montrent les vrais messages du moment. Le relecteur regarde les planches ; un
message inconvenant ou trop personnel → nouvelle prise *(choix de Claude ; pas de flou)*.

**La commande de session** montre l'adresse de la clé de session générée sur le simulateur (pas de secret) ; la session
n'est jamais accordée (on ne lance pas la commande).

## 4. Le pipeline

Réutilise `demo/` tel quel (capture idb/simctl → `timeline.json`, voix kokoro-js, montage Remotion, `demo:check`),
avec :

- **Choix du script par `DEMO`** : `DEMO=beta` → `demo/beta.ts`, sorties dans `demo/out-beta/` ; sans `DEMO`,
  `demo/script.ts` et `demo/out/` comme avant. Capture, voix, plan, rendu et check lisent le même module
  (`lib/which.ts`) ; Remotion reçoit `--public-dir` et le chemin de sortie.
- **Le script décrit sa cible** (champs facultatifs de `Script`, défauts = la première démo) :
  - `target: 'production'` → pas de `Stage` (ni gnodev, ni faux serveur, ni relais), pas de wallet installé, preflight
    réduit au build de l'app et aux outils idb/ffmpeg ;
  - `device` : `{ name, type, runtime }` — pour la bêta l'iPhone 18 Pro sous iOS 27 (le runtime 26.5 n'est plus là) ;
  - `app` : le chemin du build (la bêta : `.state/build-nowallet/…/gnoworld.app`) ;
  - `teardown: Step[]` → joués après l'arrêt de l'enregistrement, même si une scène a échoué après la création du
    salon (best effort, erreurs signalées sans masquer celle de la capture) ;
  - `check: { min, max }` (s) → bornes de `demo:check` ;
  - `output` → nom du MP4.
- **Nouvelle action `drag`** : appui maintenu puis glissement lent (le réticule du graphique ne suit qu'un appui long ;
  mémoire : « idb slow swipe = hold-then-slide »). `idb ui swipe` avec une durée longue et un premier segment immobile,
  ou une suite de petits `swipe` — au constructeur de trouver ce qui marche.
- **Build** : `DEMO=beta npm run demo:build` fait seulement le Release simulateur avec `EXPO_PUBLIC_WALLET=off`, dans un
  `derivedDataPath` à part (`.state/build-nowallet`) ; `ios/` est régénéré si besoin par `expo prebuild` (CNG).
- **Cartes** : le composant `Card` existant suffit (titre, sous-titre vert, lignes).

**Prise :** appareil effacé, barre d'état figée à 9:41, app installée, lancée sur Home. Avant l'enregistrement, une
étape de setup attend que Home ait chargé ses données (le prix affiché) ; le reste se passe à l'écran.

## 5. Vérification

- Tests unitaires de `demo/` (node --test) verts, nouveaux tests pour ce qui est pur (choix du script et des chemins,
  défauts de `Script`, bornes de check).
- `DEMO=beta npm run demo:check` vert ; `npm run demo:check` (première démo, sur son rendu existant) toujours vert.
- Relecture de Claude : planches de contact, quelques images fixes par scène, script relu pour l'exactitude (les
  libellés et textes de l'app cités doivent être ceux de l'écran).
- Lint et typecheck de l'app propres (`demo/` en est exclu ; l'app ne change pas).
- Le salon « gno devs » n'existe plus sur gno.world après la prise (le teardown a réussi, vérifié dans ses logs).

## 6. Laissé au constructeur

Le détail des étapes idb (libellés lus dans l'arbre d'accessibilité à la première prise), les zooms, la mise au point
de `drag`, la vitesse des plans, le découpage du module de chemins.

## 7. À faire avant de publier la vidéo (pas dans ce travail)

Le build sur TestFlight / Play (1.0.0, 28 octobre) n'a ni Home ni les salons : il faut fusionner la PR #4 et lancer
une Release pour que les testeurs installent ce que montre la vidéo. Inviter des personnes extérieures sur TestFlight
passe par un groupe externe, donc une revue Beta App Review du build ; Play internal testing accepte jusqu'à
100 testeurs, ajoutés par l'adresse de leur compte Google.
