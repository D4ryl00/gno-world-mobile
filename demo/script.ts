import type { Script } from './lib/types.ts';

const ALICE = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
const REALM = '/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6';

// Labels as the accessibility tree reads them (2026-10-13 walk-through; trees in capture/fixtures/).
const script: Script = {
  voice: 'af_heart',
  // off camera, before recording
  setup: [
    // gnokey-mobile: the local chain and relay, then Alice's identity (its first session, granted on the computer)
    { id: 'wallet', do: { launch: 'wallet' } },
    { id: 'wallet-start', do: { tap: 'Create Session Key' } },
    // a first-boot banner ("Ready for Apple Intelligence") may cover the top: an upward swipe dismisses it
    { id: 'banner', do: { swipe: [200, 70, 200, 5] } },
    { id: 'wallet-settings', do: { at: [364, 84] } }, // the gear has no label
    { id: 'in-settings', do: { waitFor: 'Apply & Test' } },
    { id: 'rpc', do: { tapEnd: 'https://rpc.topaz.testnets.gno.land' } },
    { id: 'rpc-clear', do: { backspace: 40 } },
    { id: 'rpc-type', do: { type: 'http://127.0.0.1:26657' } },
    { id: 'chain', do: { tapEnd: 'topaz-1' } },
    { id: 'chain-clear', do: { backspace: 10 } },
    { id: 'chain-type', do: { type: 'dev' } },
    { id: 'apply', do: { tap: 'Apply & Test' } },
    { id: 'applied', do: { waitFor: /^Connected — block height/ } },
    { id: 'relay', do: { tapEnd: 'wss://gnokey-pair.berty.io/v1' } },
    { id: 'relay-clear', do: { backspace: 34 } },
    { id: 'relay-type', do: { type: 'ws://127.0.0.1:4000/v1' } },
    { id: 'settings-done', do: { tap: 'Done' } },
    { id: 'master', do: { type: ALICE, into: 'Master address (g1...)' } },
    { id: 'key-name', do: { type: 'alice', into: 'Key name in gnokey (e.g. mykey)' } },
    // SwiftUI spends the next tap on dismissing the keyboard: dismiss it with the keyboard's own return key
    { id: 'keyboard', do: { tap: 'return' } },
    { id: 'authorize', do: { tap: 'Authorize on Computer' } },
    { id: 'sign', do: { computer: 'sign' } },
    { id: 'wallet-ready', do: { waitFor: 'ACTIVE', timeout: 60_000 } },
    // gno.world: the local chain and chat server, the name alice
    { id: 'app', do: { launch: 'app' } },
    { id: 'settings', do: { tap: /^Settings, tab/ } },
    { id: 'local', do: { tap: 'Local gnodev' } },
    { id: 'server', do: { tapEnd: 'https://gno.world' } },
    { id: 'server-clear', do: { backspace: 20 } },
    { id: 'server-type', do: { type: 'http://127.0.0.1:8787' } },
    { id: 'save', do: { tap: 'Save' } },
    { id: 'chat', do: { tap: /^Chat, tab/ } },
    { id: 'me', do: { tap: 'you' } },
    { id: 'name', do: { tapEnd: 'name' } },
    { id: 'name-clear', do: { backspace: 6 } },
    { id: 'name-type', do: { type: 'alice' } },
    { id: 'save-name', do: { tap: 'Save name' } },
    // the sheet may close by itself on Save name
    { id: 'done', do: { tap: 'Done', timeout: 4000 }, optional: true },
  ],
  scenes: [
    {
      id: 'title', show: 'card', captions: [],
      voice: 'This is gno.world, a game on gno.land, played from a phone with gnokey-mobile. Everything you are about to see runs on a local gno chain.',
      card: { title: 'gno.world', sub: '+ gnokey-mobile' },
    },
    {
      id: 'chat', show: 'phone', captions: ['Off-chain chat, on-chain game'],
      voice: "gno.world has its own chat, off chain, on the game's server. Bob has just opened a pool with a fifty GNOT pot, and he wants Alice in.",
      steps: [
        { id: 'open', do: { waitFor: 'say something' }, mark: true },
        { id: 'bob', do: { bob: "new pool's up — 50 GNOT pot, you in?" } },
        { id: 'bob-seen', do: { waitFor: /new pool's up/ }, mark: true },
        { id: 'reply', do: { type: 'on my way', into: 'say something' } },
        { id: 'send', do: { tap: 'send' }, mark: true },
        { id: 'sent', do: { waitFor: 'alice, now' }, mark: true },
      ],
      zoomOn: ['bob-seen', 'sent'],
    },
    {
      id: 'connect', show: 'phone+terminal',
      captions: ['GnoConnect: a launch link, no SDK', 'Which realms, how much, how long', 'The master key signs on the computer'],
      voice: "To play, the app needs a session key. It opens gnokey-mobile with a GnoConnect link: a plain URL, no SDK. The wallet shows what the app asks for: which realms, how much per hour, and for how long. Alice's master key is not on the phone. The wallet hands the request to her computer, where gnokey-pair shows it again, asks for her password, signs it and broadcasts it. Back in the app, the session is live.",
      steps: [
        { id: 'tab', do: { tap: /^Session, tab/ }, mark: true },
        { id: 'ask', do: { tap: 'Get a session from gnokey-mobile' }, mark: true },
        { id: 'wallet', do: { waitFor: 'Authorize App' }, mark: true },
        { id: 'realms', do: { waitFor: /bubblerumble6$/ }, mark: true },
        { id: 'authorize', do: { tap: 'Authorize on Computer' }, mark: true },
        { id: 'sign', do: { computer: 'sign' }, mark: true },
        { id: 'active', do: { waitFor: 'Session active', timeout: 60_000 }, mark: true },
      ],
      zoomOn: ['realms', 'active'],
    },
    {
      id: 'play', show: 'phone',
      captions: ['Signed on the phone by the session key', 'No popup, no wallet hop'],
      voice: 'Now every boop is a real transaction on the chain, signed on the phone by the session key, within its budget. No popup, and no trip to the wallet.',
      steps: [
        { id: 'pools', do: { tap: /^Pools, tab/ }, mark: true },
        { id: 'pool', do: { tap: /^Friday pot/ }, mark: true },
        { id: 'boop1', do: { tap: /^boop / }, mark: true },
        { id: 'booped1', do: { waitFor: /· 1 boops ·/, timeout: 30_000 }, mark: true },
        { id: 'boop2', do: { tap: /^boop / }, mark: true },
        { id: 'booped2', do: { waitFor: /· 2 boops ·/, timeout: 30_000 }, mark: true },
        { id: 'boop3', do: { tap: /^boop / }, mark: true },
        { id: 'booped3', do: { waitFor: /· 3 boops ·/, timeout: 30_000 }, mark: true },
        { id: 'web', do: { gnoweb: `${REALM}:1` } },
        { id: 'back', do: { tap: 'Pools' } }, // a pushed screen hides the tab bar
      ],
      zoomOn: ['boop1', 'booped3'],
    },
    {
      id: 'chain', show: 'browser', captions: ['Real transactions on a local gno chain'],
      voice: "And the realm agrees: Alice's three bids are in the pool's history, on chain.",
    },
    {
      id: 'bob2', show: 'phone', captions: [],
      voice: 'But in the chat, anyone can call themselves Alice.',
      steps: [
        { id: 'chat', do: { tap: /^Chat, tab/ }, mark: true },
        { id: 'bob', do: { bob: 'nice! but anyone can call themselves alice 😉' } },
        { id: 'seen', do: { waitFor: /anyone can call themselves alice/ }, mark: true },
      ],
      zoomOn: ['seen'],
    },
    {
      id: 'name', show: 'phone+terminal',
      captions: ['connect, with a challenge', 'gnokey sign-data: nothing goes on chain', 'A reserved name, proven'],
      voice: 'A reserved name needs a proof. The app sends a GnoConnect connect with a challenge. The wallet shows the text to sign and hands it to the computer, where gnokey sign-data signs it with the master key. Nothing goes on chain. The server checks the signature, and alice is now a reserved name.',
      steps: [
        // the server takes a boop from the last 3 minutes as proof, which would skip the challenge: let it lapse
        { id: 'lapse', do: { pause: 185_000 } },
        { id: 'me', do: { tap: 'alice' }, mark: true },
        { id: 'reserve', do: { tap: 'Reserve this name' }, mark: true },
        { id: 'challenge', do: { waitFor: 'TEXT TO SIGN' }, mark: true },
        { id: 'sign', do: { computer: 'sign' }, mark: true },
        { id: 'proved', do: { waitFor: '✓ yours', timeout: 60_000 }, mark: true },
        { id: 'done', do: { tap: 'Done', timeout: 4000 }, optional: true }, // the sheet may already be closed
        { id: 'chip', do: { waitFor: 'alice ✓' }, mark: true },
      ],
      zoomOn: ['challenge', 'proved', 'chip'],
    },
    {
      id: 'end', show: 'card', captions: [],
      voice: 'GnoConnect: one standard between dapps and wallets. Launch links on mobile, in-page wallets in the browser.',
      card: {
        title: 'GnoConnect',
        sub: 'draft standard · gnokey-mobile · gnokey sign-data',
        lines: ['gnolang/gno #5970 · #6016 · #6322', 'Filmed on a local test chain'],
      },
    },
  ],
};

export default script;
