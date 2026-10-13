#!/usr/bin/env bash
# Prints what gnokey-pair prints, asks what it asks. FAKE_PAIR=unexpected asks something else first.
printf 'Signing with gnokey (gnokey v0)\n\nOn your phone, choose "Send to my computer" and scan this code, or type it:\n\n    █▀▀▀▀▀█ ▄▀ █▀▀▀▀▀█\n    █ ███ █ ▀▄ █ ███ █\n    7-guitarist-revenge\n\nWaiting for the phone (3m0s)...\n'
sleep 0.2
printf 'Connected. Check words: apple banana (your phone shows the same)\n\n1. Create session  gpub1… (g1…)\n\n'
if [ "${FAKE_PAIR:-}" = unexpected ]; then printf 'No -remote given. Use the node the phone suggests for dev, http://x? [y/N] '; read -r a; exit 3; fi
printf 'Sign? [y/N] '
read -r a
[ "$a" = y ] || { printf '\nCancelled.\n'; exit 1; }
printf 'Enter password to decrypt key\n'
read -rs p
printf 'Simulating the signed transaction...\nBroadcasting...\nIncluded in block 12, hash ABC\n\nDone.\n'
