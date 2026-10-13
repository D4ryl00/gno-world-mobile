# gno.world app artwork

Official artwork downloaded from gno.world on 2026-10-13:

- `gno-bubble-1280.png`: https://gno.world/brand/gno-bubble-1280.png — the installable site's icon, declared in https://gno.world/manifest.webmanifest.
- `gno-icon.svg`: https://gno.world/gno-icon.svg — the site's favicon and vector Gno symbol.

The files in `../images/` are derived from these originals:

- `icon.png`: opaque 1024 × 1024 resize of the official globe artwork, used on iOS and as the default icon.
- `android-icon-foreground.png`: the globe artwork with the surrounding space removed, scaled onto a transparent 1024 × 1024 canvas. The globe fits inside Android's central 66/108 safe circle; the background is configured in `app.json`.
- `android-icon-monochrome.png`: the SVG's two symbol paths in white on transparency, centered within Android's safe area.
- `favicon.png`: 64 × 64 rasterization of the original SVG.
- `splash-icon.png`: the SVG symbol without its background, cropped to the symbol on transparency so `imageWidth` in `app.json` sets the symbol width.

Native icons and the splash screen require a new native build. The generated `ios/` and `android/` folders are ignored by Git; Expo prebuild applies `app.json` to them.
