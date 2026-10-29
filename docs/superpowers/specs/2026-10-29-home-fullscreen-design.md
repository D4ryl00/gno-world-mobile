# Cartes d'Accueil en plein écran — design

Décidé le 2026-10-29. Toucher une des trois cartes d'Accueil (GNOT, Here Now, Chat) l'ouvre en plein écran avec plus
de détails ; on revient à Accueil d'un geste. Spec parente : `2026-10-29-home-tab-design.md` (les cartes, leurs
routes, leurs textes). Maquettes validées : `.superpowers/brainstorm/59613-1793280545/content/fullscreen-cards.html`
(non suivie par git ; les captures d'écran du site qui l'ont inspirée sont décrites au §4.1).

## 1. Objectif

Les cartes d'Accueil se lisent d'un coup d'œil ; le plein écran sert à creuser une carte sans quitter Accueil : lire le
cours à un moment précis, voir où sont les gens, parcourir le chat.

**Critères de réussite :**

1. Toucher chacune des trois cartes ouvre sa vue plein écran ; un glissement vers le bas (iOS) ou ✕ (partout) ramène
   à Accueil tel qu'il était.
2. GNOT : en tenant puis glissant un doigt sur le graphique, on lit la date, l'heure, le cours et le volume de cet
   instant — les mêmes valeurs que le site pour la même période.
3. Here Now : la carte du monde montre un point par lieu renvoyé par le serveur ; le tableau donne tous les pays, sans
   coupure.
4. Chat : la conversation se lit et défile, se met à jour en direct, et rien ne permet d'écrire ni de réagir.

## 2. Périmètre

**Dans cette version :** la carte GNOT d'Accueil qui affiche fdv comme le site (§9), trois routes plein écran (§3), leurs contenus (§4), le toucher des cartes d'Accueil qui les
ouvre, la lecture des champs `fdv`, `supply` et `volumes` de `/api/prices`, la lecture de `spots` de `/api/where`, un
contour des terres embarqué dans l'app, ces champs ajoutés au faux serveur (`scripts/fake-offchain/server.ts`).

**Pas dans cette version (non-objectifs) :** zoom ou défilement du graphique, chandeliers, choix d'une autre monnaie
que GNOT, globe, pools sur la carte, toucher un pays ou un point de la carte, écrire, réagir ou voter depuis le chat en
lecture seule.

**Anti-objectifs (échec même si « ça marche ») :**

- un plein écran dont on ne sait pas sortir, ou dont on sort par accident en lisant le graphique ;
- des chiffres qui diffèrent du site pour la même période ;
- un chat « lecture seule » où un appui long ouvre quand même le menu d'actions.

## 3. Ouvrir et fermer

- Trois routes Expo Router hors des onglets, présentées en `modal` sur la pile racine (`src/app/_layout.tsx`) — sur
  iOS, une feuille quasi plein écran qui se ferme en la glissant vers le bas ; sur Android, ✕ et le bouton retour du
  système. Chaque vue a un ✕ en haut à droite. *(Mon choix : `modal` plutôt que `fullScreenModal`, qui n'offre pas le
  glissement ; si tu veux vraiment tout l'écran, c'est une option à changer.)*
  **Sauf GNOT, en `fullScreenModal`** (décidé à la revue, 2026-10-29) : sur le simulateur iOS, une feuille — même
  verrouillée (`gestureEnabled: false`) — se laisse tirer vers le bas dès qu'un doigt glisse un peu vers le bas sur le
  graphique, et prend le toucher au réticule. La vue GNOT couvre donc tout l'écran et se ferme par ✕ (et le retour
  Android) ; Here Now et Chat restent des feuilles.
- **Carte GNOT** : toucher la carte hors des boutons de période ouvre le plein écran ; les boutons 1d / 7d / 30d
  gardent leur rôle sur la carte. Le plein écran s'ouvre sur la période de la carte ; y changer de période ne change
  pas la carte d'Accueil. *(Mon choix.)*
- **Carte Here Now** : toucher n'importe où ouvre le plein écran ; le défilement des lignes dans la carte reste
  possible (un toucher bref ouvre, un glissement fait défiler).
- **Carte Chat** : toucher ouvre désormais le plein écran en lecture seule, et non plus l'onglet Chat ; le lien du bas
  de la vue (§4.3) y mène. Le libellé d'accessibilité reste celui d'aujourd'hui ; l'indice devient « Opens the chat to
  read ».
- Pendant que le plein écran est ouvert, Accueil n'a plus le focus : ses chargements s'arrêtent (règle existante de
  `usePoll`) ; ceux du plein écran tournent. En le fermant, Accueil recharge ce qui a vieilli au-delà de son intervalle.

## 4. Les trois vues

Couleurs, polices, marges : celles d'Accueil (`@/theme`). Chaque vue charge ses données comme sa carte (mêmes routes,
mêmes intervalles : prix toutes les 5 min, présence toutes les 20 s, chat par le store existant), avec les mêmes textes
de chargement et d'échec que les cartes.

### 4.1 GNOT

Modèle : la fenêtre de prix agrandie du site (capture fournie le 2026-10-29 : courbe avec aire, axe des prix à droite,
axe du temps en bas, barres de volume en bas, réticule en pointillés, étiquette du cours sur l'axe, étiquette de la
date sur l'axe du temps).

De haut en bas :

1. **En-tête** : « GNOT », le cours, la variation (mêmes formats que la carte), 1d / 7d / 30d, ✕.
2. **Ligne de lecture** sous l'en-tête : vide au repos ; pendant le réticule, comme le site (`priceReadout`) :
   `<date courte> <heure:minute> · $<cours> · vol $<volume>` (ex. « 27 Oct 14:05 · $0.0594 · vol $1.2k »). Comme le
   site, « vol $0 » s'affiche pour un point sans échange ; la partie volume n'est omise que si le point n'a pas de
   valeur.
3. **Graphique**, la plus grande partie de l'écran :
   - la courbe du cours (couleur selon le signe de `change`, rouge `#ff7676` / vert `#3ddc84` comme le site) avec une
     aire pâle dessous ;
   - axe des prix à droite, 4 à 6 graduations rondes, lignes horizontales discrètes ;
   - axe du temps en bas : heures en 1d, jours en 7d, dates en 30d ;
   - barres de volume dans le bas du graphique (environ le cinquième de sa hauteur), même couleur atténuée ;
   - **réticule** : tenir le doigt sur le graphique (appui long court) puis glisser horizontalement ; il suit le point
     le plus proche, avec une ligne verticale et une horizontale en pointillés, un point sur la courbe, le cours dans
     une étiquette sur l'axe de droite. Lever le doigt l'efface et la ligne de lecture se vide. La vue GNOT n'étant pas
     une feuille (§3), rien ne dispute le doigt au réticule.
4. **Chiffres** en grille de deux colonnes : fdv, market cap, supply (« 1.33B GNOT »), volume de la période (somme de
   `volumes`), plus haut et plus bas de la période. Un chiffre absent ou nul du serveur n'est pas affiché.

Données : `/api/prices?coin=gnot&days=N` renvoie aussi `fdv` (USD), `supply` (unités), `volumes` (`[[secondes, USD],
…]`, même pas de temps que `series`). Le site affiche « fdv $… » en tête et la market cap en info-bulle (§9).

### 4.2 Here Now (option A choisie)

1. **En-tête** : « HERE NOW », le total (texte de `hereText`), ✕.
2. **Carte du monde plate** (équirectangulaire), largeur de l'écran : terres en gris foncé, un point jaune
   (`colors.accent`) par lieu de `spots` (`{cc, lat, lon, n}`), plus gros quand `n` est plus grand. Sous la carte, en
   petit : « a dot per place, about 25 km precise ». Sans `geo` (le serveur ne place personne), pas de points et la
   note dit « countries unavailable on this build ».
3. **Tableau complet** des pays, défilant : les colonnes de la carte (drapeau, nom, barre, nombre) plus la part du
   total en pourcent ; la ligne « elsewhere » et la ligne « unknown » (sans geo) comme sur la carte d'Accueil.

Le contour des terres est calculé une fois, hors de l'app, depuis `world-atlas` 110m (Natural Earth, domaine public) et
embarqué comme chemin SVG en coordonnées lon/lat (pas de bibliothèque de cartes ni de d3 dans l'app). L'Antarctique
peut être coupée.

### 4.3 Chat en lecture seule

1. **En-tête** : « CHAT », le nombre de présents comme l'onglet Chat (« N here »), ✕.
2. **La conversation**, plus récente en bas, qui défile et se met à jour en direct depuis le store du chat ; les lignes
   rendues comme dans l'onglet Chat (noms, heures, pièces jointes, réponses) mais sans menu d'appui long, sans
   réactions ni votes touchables. Les liens et le saut vers la ligne citée restent touchables (ils servent à lire) ;
   le chargement des lignes plus anciennes suit ce que fait l'onglet Chat. *(Mon choix.)*
3. **En bas** : « Write in Chat › », qui ferme la vue et ouvre l'onglet Chat.

Lire ici compte comme lire dans l'onglet Chat : les lignes affichées sont marquées vues (le badge de l'onglet
s'efface). *(Mon choix.)*

## 5. Contraintes

- Expo SDK 58, Expo Router ; routes dans `src/app/`, le reste hors de `src/app/`.
- Pas de nouvelle dépendance native : `react-native-svg`, `react-native-gesture-handler` et `react-native-reanimated`
  sont déjà là. Une dépendance JS seulement si elle se justifie ; le contour des terres est une donnée, pas une
  bibliothèque.
- Tests jest pour chaque comportement, `npx expo lint` et `npx tsc --noEmit` propres, commits signés (`git commit -s`).
- Tester sur le simulateur iOS ; Android si l'émulateur répond.

## 6. Laissé au constructeur

Découpage des composants (le graphique plein écran et celui de la carte peuvent partager `chartGeom`), le pas exact
des graduations, la taille des points, la gestion du geste (long press puis pan de gesture-handler, ou autre), le
format exact de la date courte (anglais, cohérent avec « 3h » de la carte Chat).

## 7. Lu dans le code du site

- `spread: true` dans `/api/where` concerne les positions des pools (`POOLGEO_SPREAD`), pas `spots` : sans objet ici.
- Quand `spots` est vide, le globe du site place les gens au pays (`by_country`). Ici, pas de points dans ce cas : il
  faudrait une table des centres des pays. *(Mon choix ; le tableau reste complet.)*

## 8. Faux serveur

`GET /api/prices` ajoute `fdv`, `supply`, `volumes` (même nombre de points que `series`) ; `GET /api/where` ajoute
`spots` cohérents avec `by_country`.

## 9. fdv sur la carte d'Accueil

La carte GNOT d'Accueil affichait « cap $11.5M » ; le site affiche « fdv $77.7M » à cet endroit (la market cap en
info-bulle). Elle passe à « fdv $… » comme le site, et à « mc $… » quand le serveur ne donne pas de fdv (règle du
site) ; rien quand aucun des deux n'est positif. La market cap reste visible dans le plein écran. La spec parente
(`2026-10-29-home-tab-design.md` §4) est corrigée en conséquence. *(Mon choix : l'utilisateur n'avait pas de
préférence ; le but de l'onglet était de copier la page d'accueil du site.)*
