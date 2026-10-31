import type { Script } from './lib/types.ts';

const ROOM = 'gno devs';

// The store build (no gnokey-mobile) on the real gno.world and gno.land mainnet, the app's defaults: nothing is set up
// and nothing is signed. Labels as the accessibility tree reads them (2026-10-30 walk-through; trees in
// capture/fixtures/beta-*.json).
const script: Script = {
  voice: 'af_heart',
  target: 'production',
  device: {
    name: 'gnoworld-beta',
    type: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
    runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
  },
  app: 'build-nowallet/Build/Products/Release-iphonesimulator/gnoworld.app',
  check: { min: 60, max: 110 },
  output: 'gnoworld-beta.mp4',
  // off camera: Home has its live data before the recording starts
  setup: [
    { id: 'app', do: { launch: 'app' } },
    // a name for the chat, as a tester would have: without one, the app asks for it first
    { id: 'chat', do: { tap: /^Chat, tab/ } },
    { id: 'me', do: { tap: 'you' } },
    { id: 'name', do: { tapEnd: 'name' } },
    { id: 'name-clear', do: { backspace: 6 } },
    { id: 'name-type', do: { type: 'demo' } },
    { id: 'save-name', do: { tap: 'Save name' } },
    // the sheet may close by itself on Save name
    { id: 'done', do: { tap: 'Done', timeout: 4000 }, optional: true },
    { id: 'named', do: { waitFor: 'demo' } },
    { id: 'home-tab', do: { tap: /^Home, tab/ } },
    // back on Home the list sits a little scrolled, the GNOT card's › under the title bar: back to the top
    { id: 'top', do: { swipe: [200, 300, 200, 700] } },
    { id: 'home', do: { waitFor: 'Open GNOT full screen', timeout: 60_000 } },
    { id: 'here', do: { waitFor: 'Open Here Now full screen', timeout: 60_000 } },
  ],
  // no zoomOn: a zoom inside the phone crops every line on the right; the screen reads at full size
  scenes: [
    {
      id: 'title', show: 'card', captions: [],
      voice: 'Two weeks ago we showed gno.world on a local chain. Here is what\'s new, filmed on the real gno.world, and how to try it yourself.',
      card: { title: 'gno.world', sub: "what's new · beta" },
    },
    {
      id: 'home', show: 'phone', captions: ['Home: price, people, chat', 'Every card opens full screen'],
      voice: "The app now opens on Home: the GNOT price, who is here right now, and the latest chat. Every card opens full screen: the chart, with a crosshair under your finger, and a map of who's around.",
      steps: [
        { id: 'open', do: { waitFor: 'Open GNOT full screen' }, mark: true },
        { id: 'look', do: { pause: 3500 }, mark: true }, // Home, while the voice names its cards
        { id: 'price', do: { tap: 'Open GNOT full screen' }, mark: true },
        { id: 'chart', do: { waitFor: 'market cap' }, mark: true }, // the Home card has the periods too
        // 24 points a second: the chart takes a touch for a crosshair after 200 ms within 8 points
        { id: 'drag', do: { drag: [60, 330, 300, 330], seconds: 10 }, mark: true },
        { id: 'close', do: { tap: 'Close' }, mark: true },
        { id: 'here', do: { tap: 'Open Here Now full screen' }, mark: true },
        { id: 'map', do: { waitFor: /^a dot per place/ }, mark: true },
        { id: 'pause', do: { pause: 2500 }, mark: true },
        { id: 'back', do: { tap: 'Close' }, mark: true },
      ],
    },
    {
      id: 'rooms', show: 'phone', captions: ['Channels: Public and the rooms', 'Make your own room'],
      voice: 'Chat has channels now. Public is one tab, next to the rooms: switch between them in one tap. Anyone can make a room: give it a name, keep it unlisted, and share its link.',
      steps: [
        { id: 'chat', do: { tap: /^Chat, tab/ } },
        { id: 'public', do: { waitFor: 'Public' }, mark: true },
        { id: 'look', do: { pause: 1500 }, mark: true },
        // other rooms' tabs: their lines load from the server
        { id: 'dev', do: { tap: 'Dev chat' }, mark: true },
        { id: 'dev-look', do: { pause: 2500 }, mark: true },
        { id: 'gnot', do: { tap: '$GNOT price chat' }, mark: true },
        { id: 'gnot-look', do: { pause: 2500 }, mark: true },
        { id: 'add', do: { tap: 'New room' }, mark: true },
        { id: 'sheet', do: { waitFor: 'Make a room' }, mark: true },
        { id: 'name', do: { type: ROOM, into: 'a name for a new room' }, mark: true },
        // the clip ends here: the share sheet the app opens next (3 s or more later) stays off camera
        { id: 'make', do: { tap: 'Make' }, mark: true },
      ],
    },
    {
      id: 'tools', show: 'phone', captions: ['Maker tools: invite, rename, pin, delete'],
      voice: 'The maker gets the tools: invite people by name, rename the room, pin a line, or delete it.',
      steps: [
        // off camera: the share sheet is not in the app's tree, only its scrim is; a tap above the sheet closes it
        { id: 'share', do: { waitFor: 'dismiss popup', timeout: 20_000 } },
        { id: 'shared', do: { pause: 1000 } },
        { id: 'close-share', do: { at: [200, 200] } },
        { id: 'room', do: { waitFor: ROOM } },
        { id: 'settle', do: { pause: 1000 } },
        // the clip starts here, the share sheet gone
        { id: 'shown', do: { waitFor: ROOM }, mark: true },
        { id: 'menu', do: { tap: 'Channel menu' }, mark: true },
        { id: 'tools', do: { waitFor: 'Delete room' }, mark: true },
        { id: 'look', do: { pause: 3000 }, mark: true },
        // the menu sheet has no close button: a tap above it
        { id: 'menu-close', do: { at: [200, 250] }, mark: true },
      ],
    },
    {
      id: 'session', show: 'phone', captions: ['gnokey-mobile: coming soon', 'A session from your computer, today'],
      voice: "Playing needs a session key. gnokey-mobile is not in the stores yet, so for now the app gives you one gnokey command to run on your computer. Your account authorises the phone's key once, with a budget and an expiry.",
      steps: [
        { id: 'tab', do: { tap: /^Session, tab/ }, mark: true },
        { id: 'soon', do: { waitFor: 'COMING SOON' }, mark: true },
        { id: 'ask', do: { tap: 'Get a session from a computer' }, mark: true },
        { id: 'command', do: { waitFor: 'Run this on your computer' }, mark: true },
        { id: 'read', do: { pause: 2000 }, mark: true },
        // down to the QR code and "I ran it"
        { id: 'scroll', do: { swipe: [200, 600, 200, 250] }, mark: true },
        { id: 'end', do: { waitFor: 'I ran it' }, mark: true },
        { id: 'look', do: { pause: 2000 }, mark: true },
      ],
    },
    {
      id: 'join', show: 'card', captions: [],
      voice: 'gno.world is now on TestFlight and Google Play internal testing. It is an early beta, with rough edges. To join, email remi at berty dot tech with your Apple ID or Google account address, and say iPhone or Android.',
      card: {
        title: 'Join the beta',
        sub: 'remi@berty.tech',
        lines: ['TestFlight (iPhone) · Google Play internal testing (Android)', 'Send your Apple ID or Google account email'],
      },
    },
    {
      id: 'next', show: 'card', captions: [],
      voice: 'Next: gnokey-mobile inside the app, so sessions and name proofs happen on your phone, without a computer. And push notifications, so you never miss a pool or a message.',
      card: {
        title: 'Next',
        lines: ['gnokey-mobile in the app: sessions and name proofs from your phone', 'Push notifications', 'Early beta · filmed on gno.world'],
      },
    },
  ],
  // the room made on camera does not stay on gno.world
  teardown: [
    // a sheet left open by a failed scene covers the tabs
    { id: 'sheet', do: { tap: 'Done', timeout: 2000 }, optional: true },
    { id: 'chat', do: { tap: /^Chat, tab/ } },
    { id: 'room', do: { tap: ROOM } },
    { id: 'menu', do: { tap: 'Channel menu' } },
    { id: 'delete', do: { tap: 'Delete room' } },
    { id: 'ask', do: { waitFor: /^Delete this room for everyone/ } },
    { id: 'confirm', do: { tap: 'Delete room' } },
    // deleted, the sheet closes and Chat goes back to Public
    { id: 'gone', do: { waitFor: /^Public/, timeout: 20_000 } },
  ],
};

export default script;
