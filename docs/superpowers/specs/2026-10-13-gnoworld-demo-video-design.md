# Vidéo de démo gno.world + gnokey-mobile — design

Une vidéo d'environ 2 min, en anglais, pour les devs gno, qui montre gno.world et gnokey-mobile parler GnoConnect :
connexion et session, jeu sans popup, nom prouvé par un challenge, fin de session, et le chat. Elle est **produite
par commande** (`npm run demo`), pour être refaite quand l'app change.

Modèle : la démo de Bolo d'un collègue (2026-10-06, 90 s, 1080p) — « The app footage is the real Bolo, recorded with
Playwright on a local gno test chain. The rest (chat, captions, animations) is code in Remotion, the voice is Kokoro
(open-source text-to-speech), and Claude reviewed the script, design and final render several times before it was
done. » Sa forme : fil de discussion qui porte l'histoire, pastilles de sous-titres, plans réels zoomés sur le bon
détail, cadres de téléphone, carte de fin « Not live yet — filmed on a test chain ».

## 1. Objectif

**Critères de réussite :**

1. `npm run demo` produit `demo/out/gnoworld-demo.mp4` (1920×1080, 30 i/s, ~2 min, voix off anglaise) sans
   intervention, sur une chaîne locale neuve.
2. Tous les plans de l'app et du wallet sont réels : le build Release de l'app et gnokey-mobile sur le simulateur iOS,
   de vraies transactions sur gnodev, le vrai `gnokey-pair` / `gnokey sign-data` dans le terminal.
3. Aucun code n'est ajouté à l'app ni au wallet pour la démo.
4. Quand l'app change, une nouvelle capture recale coupes et zooms sans retoucher de coordonnées à la main.
5. Le rendu passe les vérifications automatiques (§7) et la relecture de Claude (script, design, rendu).

## 2. Périmètre

**Dedans :** la capture (simulateur iOS seul), la voix (kokoro-js), le montage (Remotion), les vérifications et la
planche de relecture, le scénario de §4.

**Dehors :** Android ; une version française ; de la musique (sauf fichier fourni par l'utilisateur, pour la licence) ;
toute diffusion (la vidéo est rendue en local, l'utilisateur la publie).

**Licence :** Remotion est gratuit pour les individus, les organisations à but non lucratif et les sociétés de 3
employés au plus ; au-delà, une licence entreprise (remotion.pro). L'utilisateur a choisi Remotion le 2026-10-13 en
connaissance de cause. kokoro-js : Apache-2.0.

## 3. Architecture

```
demo/                          package.json propre (remotion, @remotion/cli, kokoro-js, …) ; exclu de Metro
                               (blockList), jest (testPathIgnorePatterns), tsc (exclude) et expo lint (ignores)
  script.ts                    la source unique : scènes, lignes de voix, sous-titres, étapes à filmer (§4)
  capture/                     npm run demo:capture
    stage.ts                   préparation hors caméra (§5)
    sim.ts                     idb (tap par libellé, saisie, glissement, attente d'un libellé) ; simctl (barre
                               d'état, recordVideo)
    actors.ts                  Bob : lignes postées sur le faux serveur hors chaîne aux étapes voulues
    terminal.ts                gnokey-pair sous un pty, sortie horodatée
    web.ts                     Playwright : le rendu gnoweb de l'état du realm sur la chaîne locale
    run.ts                     joue les étapes de script.ts, filme, écrit out/capture/
  voice/                       npm run demo:voice → out/voice/<id>.wav + durations.json (cache par empreinte du texte)
  video/                       Remotion : Root, scènes, PhoneFrame, Caption, Terminal, BrowserFrame, Zoom, cartes
                               npm run demo:render → out/gnoworld-demo.mp4
  check/                       npm run demo:check → vérifications (§7) et out/review/sheet-*.png
  out/                         ignoré par git
package.json (racine)          demo, demo:capture, demo:voice, demo:render, demo:check, demo:build (délèguent à demo/)
```

**`out/capture/` :**

- `sim.mp4` — l'écran du simulateur, d'un seul tenant (`simctl io recordVideo --codec h264`) ;
- `terminal.jsonl` — `{t, text}` par morceau de sortie de gnokey-pair ;
- `gnoweb.png` (ou `.mp4`) — le rendu du realm ;
- `timeline.json` — une marque par étape : `{id, t, box?}` où `t` est le temps dans `sim.mp4` (s) et `box`
  `{x, y, w, h}` (en points iOS) de l'élément touché ou attendu, lu dans `idb ui describe-all`. Plus la taille de l'écran en
  points et en pixels.

**Le montage lit `timeline.json` :** chaque scène nomme les marques qui la bornent et celle sur laquelle zoomer ; les
attentes sont accélérées, la dernière image gelée si la voix est plus longue ; le zoom cadre `box` (marge, bornes de
l'écran, transition douce). Ces calculs vivent dans des fonctions pures testées (`video/fit.ts`).

## 4. Scénario

Fil rouge : le **vrai chat de gno.world**, Alice (l'héroïne, dans l'app) et Bob (scripté). Textes provisoires, revus
avec l'utilisateur et par Claude avant le rendu final.

| # | Durée | À l'écran | Voix off | Sous-titres |
|---|---|---|---|---|
| 0 | 6 s | Carte titre : logo gno.world, puis « + gnokey-mobile » | « A gno dapp and a mobile wallet, talking over GnoConnect. » | — |
| 1 | 12 s | Chat : Bob « new pool's up — 50 GNOT pot, you in? » ; Alice « on my way » | « gno.world is a game on gno.land, with its own chat. » | Off-chain chat, on-chain game |
| 2 | 25 s | Session → gnokey-mobile, demande de session (realm, plafond, durée) → « Authorize on Computer » → terminal (gnokey-pair montre la revue, la clé maître signe) → retour, « Session active » | « The app opens the wallet with a plain launch link. The wallet asks the computer, where the master key lives, to grant a session key: one realm, a spending cap, an expiry. » | `connect` — a link, no SDK / A session key: scoped, capped, expiring |
| 3 | 22 s | Boops dans un pool, sans passer par le wallet ; puis l'état du realm (gnoweb, cadre de navigateur) | « Every move is a real transaction, signed by the session key. No popup, no wallet hop. » | Signed by the session key / Real txs on a local gno chain |
| 4 | 8 s | Chat : Bob « nice! who are you? anyone can be 'anon' » | — | — |
| 5 | 25 s | Réserver le nom → le wallet montre le challenge → « Sign on my computer » → terminal (gnokey-pair reçoit, `gnokey sign-data` signe) → nom ✓ dans le chat | « To prove who she is, the app sends a challenge. The master key signs it on her computer — it never touches the phone. » | `connect` + `challenge` / The master key stays on the computer |
| 6 | 14 s | Session → Revoke → gnokey-mobile « Revoke on Computer » → terminal → retour ; le boop suivant redemande une session | « Revoking is the account's call: the computer signs it, and the dapp has to ask again. » | Revoke any time |
| 7 | 8 s | Carte de fin : GnoConnect — draft standard · gnokey-mobile · gnokey sign-data ; #5970, #6016, #6322 ; « Filmed on a local test chain » | « GnoConnect: one standard, any wallet. » | — |

**Ordinateur :** dans gnokey-mobile, créer ou révoquer une session et signer un challenge passent par gnokey-pair sur
l'ordinateur (« Send to my computer » : code tapé dans le wallet, revue et mot de passe dans le terminal). Le terminal
apparaît donc dans les scènes 2, 5 et 6 (relevé dans le code de gnokey-mobile et de gnokey-pair le 2026-10-13, en
écrivant le plan).

**Style :** proche de Bolo, aux couleurs de gno.world (fond `#06090e`, vert `#3ddc84`, symbole de `assets/brand/`) ;
plans de l'app dans un cadre d'iPhone, zoomés sur l'élément touché ; pastilles de sous-titres en bas ; le terminal en
fenêtre sombre à côté du téléphone ; une voix Kokoro anglaise (choisie à l'écoute, consignée dans `script.ts`).

## 5. La capture

**Préparation (hors caméra, `stage.ts`) :**

1. Vérifier les outils (idb-companion ≥ 1.6.4, runtime iOS 26.5, ffmpeg, Playwright, gnokey avec `sign-data`,
   gnokey-pair) et les builds ; sinon s'arrêter en disant quoi faire (`npm run demo:build` construit le Release de
   l'app et gnokey-mobile pour le simulateur).
2. Chaîne neuve : `npm run gnodev` (devchain, port dédié), le faux serveur hors chaîne, un relais local pour
   gnokey-pair ; les comptes d'Alice et de Bob financés.
3. Appareil dédié « gnoworld-demo » (iPhone 17 Pro, iOS 26.5) créé ou réutilisé, **effacé** ; les deux apps installées ;
   barre d'état figée (`simctl status_bar override` : 9:41, batterie pleine, réseau plein).
4. Par l'interface (comme un utilisateur) : la clé maître d'Alice importée dans gnokey-mobile, le réseau local et le
   relais local dans ses réglages ; dans l'app, la chaîne locale et le faux serveur dans Settings ; le nom affiché
   « alice » ; le pool de la scène 3 créé par Bob (gnokey, hors simulateur).

**Prise (`run.ts`) :** `recordVideo` démarre, puis chaque étape de `script.ts` : action idb (tap par libellé,
saisie, glissement), attente d'un libellé (délai maximal), marque dans `timeline.json`. Bob poste ses lignes quand
une étape le demande ; `terminal.ts` lance gnokey-pair au début de la scène 5 ; `web.ts` filme gnoweb après la
scène 3. Règles du simulateur (mémoire) : jamais de Return, 0,3 s entre deux touches, taper un champ avant d'y
écrire, confirmer « Open in … ? » quand iOS le demande.

**Échec :** capture d'écran et arbre d'accessibilité dans `out/capture/fail/`, message qui nomme l'étape, tout est
arrêté (gnodev, serveur, companion, enregistrement).

**À vérifier au début de l'implémentation**, en signalant tout écart plutôt qu'en ajoutant du code pour la démo :
la réaction de l'app au boop qui suit une révocation (si elle est mauvaise, c'est un bug de l'app, traité comme tel) ;
gnokey-pair sans interaction après son lancement (ou mot de passe par stdin) ; le rendu gnoweb du realm sur gnodev.

## 6. Voix et montage

**Voix :** une ligne de voix par scène (ou deux), générée par kokoro-js (modèle ONNX local), en WAV ; durée mesurée
dans `durations.json` ; régénérée seulement si son texte ou la voix change.

**Montage :** une scène dure `max(voix + marge, plan minimal)` ; le plan est ajusté à cette durée (accélération des
attentes jusqu'à ×4, gel de la dernière image) ; les sous-titres suivent la voix ; transitions courtes entre scènes.
Rendu `npx remotion render` en H.264, 1080p, 30 i/s, AAC.

## 7. Vérification

- **Tests unitaires** (test runner de Node, dans `demo/`) : `fit.ts` (durées, accélérations, gel, zoom cadré sur une
  `box`, bornes) ; la lecture de `timeline.json` et de `durations.json` (fichier manquant ou abîmé : erreur claire).
- **`npm run demo:check`** après le rendu : durée totale entre 1 min 45 et 2 min 15 ; aucune voix ne déborde de sa
  scène ; aucun sous-titre hors du cadre ; toutes les marques de `script.ts` présentes dans `timeline.json` ; planche de
  vignettes (une toutes les 2 s) dans `out/review/`.
- **Relecture de Claude**, en plusieurs passes : le script (texte et exactitude technique), le design (une scène rendue
  en image fixe), puis le rendu final (planches et extraits) ; les corrections reviennent dans `script.ts` ou
  `video/`, puis on refait le rendu.
- **Lint et typecheck** de l'app restent propres : `demo/` en est exclu, et l'app est inchangée.

## 8. Décisions

- Public : les devs gno (2026-10-13).
- Scènes : connexion et session, jeu sans popup, nom prouvé, fin de session, et le chat comme fil rouge (2026-10-13).
- iOS seul (2026-10-13).
- Dans `~/bubblerumble/demo/`, avec son propre `package.json` (2026-10-13) ; jamais dans gnokey-mobile (le wallet ne
  nomme aucune dapp).
- Anglais, ~2 min (2026-10-13).
- Remotion + kokoro-js + capture idb/simctl (approche 1, 2026-10-13).
