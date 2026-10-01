# Temporary patches

`@gnolang+gnonative+0.1.2.patch` fixes a crash on Expo SDK 57 (Hermes): gnonative's
`expo/src/index.ts:10` (and build/index.js) assigns `Symbol.asyncIterator`, which is
read-only there ("Cannot assign to read-only property 'asyncIterator'"), so importing
`@gnolang/gnonative` throws. The patch only defines it when missing.

This is temporary. When a gnonative build containing the upstream fix is installed,
delete this patch together with the `postinstall` script and the `patch-package`
devDependency in package.json. An `npm install` failing in postinstall on this patch
is the signal that the upstream fix has landed.
