import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import { createStore } from 'zustand/vanilla';

import { NO_IDENTITY } from '@/offchain/chat/identity';
import type { SyncState } from '@/offchain/sync/store';
import { PairScreen, SPENT } from '@/screens/pair';

const KEY = new Uint8Array(32);
const WORDS = 'paired — your chat rooms are the same on both devices, and the name remi is yours here too ✓';

function make(p: Partial<SyncState> = {}) {
  return createStore<SyncState>()(() => ({
    paired: false, group: '', code: null, said: null, rooms: [], lastSync: 0, failing: false, busy: null, offerError: '', acceptError: '',
    resume: jest.fn(), pause: jest.fn(), restart: jest.fn(), changed: jest.fn(), clearError: jest.fn(),
    offer: jest.fn(async () => 'K7XQ2M'), open: jest.fn(async () => KEY), use: jest.fn(async () => WORDS), stop: jest.fn(async () => undefined),
    ...p,
  }));
}
const press = (label: string) => (_t: string, _m?: string, buttons?: AlertButton[]) => buttons?.find((b) => b.text === label)?.onPress?.();

afterEach(() => jest.restoreAllMocks());

test('not paired: the explanation, and a code on demand', async () => {
  const store = make();
  render(<PairScreen store={store} identity={NO_IDENTITY} />);
  expect(screen.getByText(/Your rooms and your reserved name live in this app/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Get a code' }));
  expect(store.getState().offer).toHaveBeenCalled();
});

test('a code given is shown large, read letter by letter, with its time left', () => {
  render(<PairScreen store={make({ code: { code: 'K7XQ2M', until: Date.now() + 580_000 } })} identity={NO_IDENTITY} />);
  expect(screen.getByLabelText('code K 7 X Q 2 M')).toBeTruthy();
  expect(screen.getByText('On the other device: /pair → enter this code')).toBeTruthy();
  expect(screen.getByText(/left$/)).toBeTruthy();
});

test('a typed code is opened, confirmed, adopted; the outcome is said', async () => {
  const store = make();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(press('Continue'));
  render(<PairScreen store={store} identity={NO_IDENTITY} />);
  fireEvent.changeText(screen.getByLabelText('pairing code'), 'k7xq2m');
  fireEvent.press(screen.getByText('Pair'));
  await waitFor(() => expect(screen.getByText(WORDS)).toBeTruthy());
  expect(store.getState().open).toHaveBeenCalledWith('k7xq2m');
  expect(alert.mock.calls[0][1]).toBe('This code came from another device. Your rooms and their keys will be shared with it, and its rooms come here. Continue?');
  expect(store.getState().use).toHaveBeenCalledWith(KEY);
});

test('already paired: the confirmation says this device leaves its pairing', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(press('Continue'));
  render(<PairScreen store={make({ paired: true })} identity={NO_IDENTITY} />);
  fireEvent.changeText(screen.getByLabelText('pairing code'), 'K7XQ2M');
  fireEvent.press(screen.getByText('Pair'));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(alert.mock.calls[0][1]).toMatch(/This device leaves its current pairing\. Continue\?$/);
});

test('cancelled after the code was taken: the code is spent, and the screen says so', async () => {
  const store = make();
  jest.spyOn(Alert, 'alert').mockImplementation(press('Cancel'));
  render(<PairScreen store={store} identity={NO_IDENTITY} />);
  fireEvent.changeText(screen.getByLabelText('pairing code'), 'K7XQ2M');
  fireEvent.press(screen.getByText('Pair'));
  await waitFor(() => expect(screen.getByText(SPENT)).toBeTruthy());
  expect(store.getState().use).not.toHaveBeenCalled();
});

test('errors sit under the section that caused them', () => {
  render(<PairScreen store={make({ offerError: 'could not make a code', acceptError: 'a code is six letters and digits' })} identity={NO_IDENTITY} />);
  expect(screen.getByText('could not make a code')).toBeTruthy();
  expect(screen.getByText('a code is six letters and digits')).toBeTruthy();
});

test('while busy, both buttons are off (no double tap)', () => {
  render(<PairScreen store={make({ busy: 'offer' })} identity={NO_IDENTITY} />);
  expect(screen.getByText('Making a code…')).toBeDisabled();
  expect(screen.getByText('Pair')).toBeDisabled();
});

test('paired: when it last synced, and Stop after a confirmation', async () => {
  const store = make({ paired: true, lastSync: Date.now() - 3000 });
  jest.spyOn(Alert, 'alert').mockImplementation(press('Stop'));
  render(<PairScreen store={store} identity={NO_IDENTITY} />);
  expect(screen.getByText('last synced just now')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('Stop')));
  expect(store.getState().stop).toHaveBeenCalled();
});

test('a failing sync says so', () => {
  render(<PairScreen store={make({ paired: true, failing: true })} identity={NO_IDENTITY} />);
  expect(screen.getByText('sync failed — retrying')).toBeTruthy();
});

test('the name and the rooms book', () => {
  const rooms = [
    { id: 'a'.repeat(20), name: 'tea', key: 'k', at: 2 },
    { id: 'b'.repeat(20), name: 'libera #gno', key: '', at: 1, irc: true as const },
  ];
  render(<PairScreen store={make({ rooms })} identity={{ ...NO_IDENTITY, reservedName: 'remi', nameKey: 'a'.repeat(32) }} />);
  expect(screen.getByText('remi ✓')).toBeTruthy();
  expect(screen.getByText('Rooms (2)')).toBeTruthy();
  expect(screen.getByText('tea 🔑')).toBeTruthy();
  expect(screen.getByText('libera #gno · IRC')).toBeTruthy();
  expect(screen.getByText('Opening rooms comes with the next update.')).toBeTruthy();
});

test('no reserved name: the other device brings its own', () => {
  render(<PairScreen store={make()} identity={NO_IDENTITY} />);
  expect(screen.getByText("no reserved name — the other device's comes along when you pair")).toBeTruthy();
});
