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
    { id: 'wallet-settings', do: { at: [364, 84] } }, // the gear has no label
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
      voice: 'A gno dapp and a mobile wallet, talking over GnoConnect.',
      card: { title: 'gno.world', sub: '+ gnokey-mobile' },
    },
    {
      id: 'chat', show: 'phone', captions: ['Off-chain chat, on-chain game'],
      voice: 'gno.world is a game on gno.land, with its own chat.',
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
      captions: ['connect — a link, no SDK', 'A session key: scoped, capped, expiring'],
      voice: 'The app opens the wallet with a plain launch link. The wallet asks the computer, where the master key lives, to grant a session key: one realm, a spending cap, an expiry.',
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
      captions: ['Signed by the session key', 'No popup, no wallet hop'],
      voice: 'Every move is a real transaction, signed by the session key. No popup, no wallet hop.',
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
    { id: 'chain', show: 'browser', captions: ['Real txs on a local gno chain'] },
  ],
};

export default script;
