# Onglet Accueil — design

Décidé le 2026-10-29. Un nouvel onglet **Accueil**, premier des onglets, qui résume l'activité de gno.world comme la
page d'accueil du site : le cours du GNOT en graphique, les gens présents par pays, un aperçu du chat. L'onglet
évoluera ; cette première version copie le site, rien de plus.
Specs parentes : `2026-10-01-bubblerumble-mobile-design.md`, `2026-10-05-p3-m2a-chat-design.md`.

## 1. Objectif

Ouvrir l'app et voir d'un coup d'œil ce qui se passe sur gno.world, sans rien toucher.

**Critères de réussite :**

1. L'app s'ouvre sur Accueil ; les trois cartes s'affichent avec les données de la production.
2. Le cours, la variation et le graphique suivent le site (mêmes routes, mêmes valeurs) ; 1d / 7d / 30d changent le
   graphique.
3. Le tableau des pays donne le même total et les mêmes lignes que la page « here » du site.
4. Toucher la carte Chat ouvre l'onglet Chat.
5. Pools garde tout ce qu'il fait aujourd'hui, liens `?ref=` compris.

## 2. Périmètre

**Dans cette version :** la route Accueil, les trois cartes (§4), leur rafraîchissement, Pools déplacé sur sa propre
route, les deux routes ajoutées au faux serveur.

**Non-buts (pour plus tard) :** le globe (WebGL côté site ; le tableau suffit, décidé le 2026-10-29), les stats des
pools et des bulles, les news, le ticker du marché, la radio, les autres fenêtres du site, toucher le graphique pour
lire un point.

**Anti-buts :** une nouvelle dépendance native pour le graphique ; ralentir le démarrage de l'app ou du chat ; une
deuxième connexion au chat.

## 3. Les routes du site

Lu dans le JS en ligne de gno.world le 2026-10-29 (`app-boot.js` : `herePaint`, `hereStatPaint` ; `app-windows.js` :
`priceOpen`, `priceLoad`) et relu en GET sur la production le même jour.

**Cours :** `GET /api/prices?coin=gnot&days=<1|7|30>` →

```json
{"coin":"gnot","name":"GNOT","days":1,"now":0.05822,"at":1793269649,"change":-0.308,
 "cap":11487970.4,"supply":1333000000,"fdv":77607260,"series":[[1793183280,0.0584], …]}
```

`series` = `[secondes, prix USD]` croissants (une minute d'écart en 1d) ; `change` en pourcent sur 24 h, le même quelle que soit la période (vérifié sur le site le 2026-10-29) ;
`cap` en USD. Le site propose 1d / 7d / 30d. Une erreur : le site écrit « prices are busy — trying again » et réessaie
(4 s puis 20 s, 8 fois au plus). Moins de 2 points : pas de graphique.

**Présents :** `GET /api/where` →

```json
{"by_country":[{"cc":"FR","n":3},{"cc":"AU","n":1}, …],"count":18,"elsewhere":0,"geo":true,"pools":{…},"spots":[…]}
```

`count` = total des gens qui ont la page ouverte (l'app y compte via `/presence`, déjà en place) ; `by_country` déjà
trié du plus grand au plus petit ; `elsewhere` = présents sans pays ; `geo: false` = pays indisponibles sur ce build.
`pools` et `spots` servent au globe : ignorés. Textes du site : `count` 0 → « nobody here right now » ; 1 → « just
you » ; sinon « N people » ; tableau vide → « nobody yet » ; `elsewhere` > 0 → une ligne « · elsewhere N » ; `geo: false` → le site ajoute
« · countries unavailable on this build » au total ; la carte garde alors le tableau, réduit à une ligne sans
drapeau : « unknown », une barre pleine et le total (décidé le 2026-10-29).

**Chat :** rien de nouveau. Le store du chat (`useChat`) tourne déjà dans toute l'app (badge de l'onglet Chat) ; la
carte lit ses dernières lignes.

## 4. L'écran

Maquette retenue le 2026-10-29 (option A, `.superpowers/brainstorm/…/home-layout.html`) : trois cartes empilées dans
l'ordre du site, la page défile.

**Carte GNOT :** en-tête « GNOT » et un sélecteur 1d / 7d / 30d (1d par défaut) ; le prix en grand, la variation en
vert (`colors.ring`) ou rouge (`colors.bad`) ; un graphique en ligne (`colors.accent`) ; la valorisation en petit comme le
site : « fdv $77.7M », ou « mc $11.5M » sans fdv (changé le 2026-10-29, voir `2026-10-29-home-fullscreen-design.md` §9).

**Carte Here now :** en-tête « Here now » et le total en mots (§3) ; puis le tableau du site, chaque ligne : drapeau,
nom du pays, barre proportionnelle au plus grand, nombre. Toute la liste (la page défile).

**Carte Chat :** en-tête « Chat › » ; les 3 dernières lignes de la room publique : nom, texte sur une ligne, âge
(« 3h », « now »). Toute la carte est un bouton qui ouvre l'onglet Chat.

**Onglets :** Accueil (« Home », icône `house.fill` / `home`), Pools, Chat, Session, Settings.

## 5. Contraintes

- Le graphique se dessine avec `react-native-svg`, déjà installé ; pas de nouvelle bibliothèque.
- Les requêtes passent par le client `Offchain` existant (`services.offchain`) : même URL de base que le reste (les
  Settings peuvent la pointer vers le faux serveur), même `X-Bid`.
- Pas de requête quand l'app est en arrière-plan.
- `npx expo lint` et `npx tsc --noEmit` propres ; tests jest pour les parties pures.

## 6. Ce qui change dans les routes

`src/app/(tabs)/index.tsx` devient Accueil ; Pools passe dans `src/app/(tabs)/pools.tsx`. Le `?ref=` qu'accepte
aujourd'hui l'index (liens qui ouvrent l'app sur `/`) doit continuer de marcher : Accueil le lit de la même façon.
Ce qui renvoie vers `/` en voulant dire Pools pointe vers `/pools` (aujourd'hui : `create-pool`, après création).

## 7. Laissé au constructeur

Découpage en fichiers (suivre `src/offchain/…` pour les lectures, `src/screens/home/` pour l'écran), forme exacte du
graphique, textes d'attente et d'erreur hors ceux du site, tests.

**Choix faits par moi (Claude), à vérifier :**

- Rafraîchissement : le cours toutes les 5 min (comme `hereStatPaint`) et à chaque changement de période ; les
  présents toutes les 20 s (le rythme de la présence) ; seulement quand Accueil est visible et l'app au premier plan ;
  tirer pour rafraîchir recharge les deux.
- En cas d'erreur, la carte garde ses dernières valeurs et ajoute une note grise ; sans valeur, le texte du site
  (« prices are busy — trying again ») et le même rythme de réessai.
- Graphique : pas d'axes, le plus haut et le plus bas écrits en petit ; hauteur fixe.
- Noms de pays en anglais depuis une table statique des codes de `src/utils/flag.ts` (ne pas compter
  sur `Intl.DisplayNames` sous Hermes) ; code inconnu → le code lui-même.
- Format du prix : 4 décimales sous 1 $ ; capitalisation abrégée (k, M, B).
- Le titre en haut de l'écran : « gno.world ».
- La carte Chat lit la room publique. Aujourd'hui le store du chat n'a qu'une room (ses `lines`) ; si les rooms
  (M2b-2) arrivent avant, la carte lit la room publique par l'accesseur qu'elles fourniront, jamais la room ouverte.
- Le faux serveur (`scripts/fake-offchain`) répond à `/api/prices` et `/api/where` avec des données fixes.
