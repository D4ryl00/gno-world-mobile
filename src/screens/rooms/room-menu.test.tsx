import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import { useStore as mockUseStore } from 'zustand';

import { screenServices } from '@/screens/channels/testing';
import { RoomMenu } from '@/screens/rooms/room-menu';

const A = 'AAAAAAAAAAAAAAAAAAAA';
const M = 'MMMMMMMMMMMMMMMMMMMM';
let mockS: ReturnType<typeof screenServices>;

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/state/app-services', () => ({
  useServices: () => mockS,
  useRooms: <T,>(sel: (s: ReturnType<typeof mockS.rooms.getState>) => T) => mockUseStore(mockS.rooms, sel),
}));
jest.mock('@/state/settings', () => ({ useSettings: <T,>(sel: (s: { offchainUrl: string }) => T) => sel({ offchainUrl: 'https://gno.world' }) }));

const labels = () => screen.getAllByRole('button').map((b) => b.props.accessibilityLabel ?? '').filter(Boolean);
const noop = () => undefined;

beforeEach(async () => {
  mockS = screenServices({
    book: { rooms: [{ id: M, name: 'my room', key: 'k1', at: 2 }, { id: A, name: 'Dev chat', key: '', at: 1 }], left: {} },
    client: { info: async (id) => ({ id, name: 'my room', listed: true, here: 2, made: 1 }) },
  });
  await mockS.ready;
});

test('with the key: Share link, Invite…, Rename, Listed publicly, Delete room, Leave, Pair with a browser', async () => {
  await render(<RoomMenu id={M} visible onClose={noop} onLeft={noop} />);
  expect(labels()).toEqual(['Share link', 'Invite…', 'Rename', 'Listed publicly', 'Delete room', 'Leave', 'Pair with a browser']);
});

test('without it: Share link, Rename, Leave, Pair with a browser', async () => {
  await render(<RoomMenu id={A} visible onClose={noop} onLeft={noop} />);
  expect(labels()).toEqual(['Share link', 'Rename', 'Leave', 'Pair with a browser']);
});

test('Public: Pair with a browser only', async () => {
  await render(<RoomMenu id="" visible onClose={noop} onLeft={noop} />);
  expect(labels()).toEqual(['Pair with a browser']);
});

// iOS drops an alert, a second modal or a share sheet asked for while a sheet is closing: everything happens in the
// sheet that is open
test('Delete room asks in the sheet, with the site\'s words, then drops the room and goes back to Public', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const onLeft = jest.fn();
  await render(<RoomMenu id={M} visible onClose={noop} onLeft={onLeft} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete room' }));
  expect(screen.getByText('Delete this room for everyone? It cannot be undone.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Delete room' }));
  await act(async () => undefined);
  expect(mockS.book().rooms.map((r) => r.id)).toEqual([A]);
  expect(onLeft).toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('Rename asks in the sheet and says there it is renamed for you', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await render(<RoomMenu id={A} visible onClose={noop} onLeft={noop} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Rename' }));
  await fireEvent.changeText(screen.getByPlaceholderText('a new name'), 'ours');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('renamed to "ours" for you (the room\'s maker or the owner renames it for everyone)')).toBeTruthy();
  expect(mockS.book().rooms.find((r) => r.id === A)?.name).toBe('ours');
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('Invite… is a form in the sheet', async () => {
  await render(<RoomMenu id={M} visible onClose={noop} onLeft={noop} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Invite…' }));
  expect(screen.getByPlaceholderText('their name')).toBeTruthy();
});

test('Share link shares over the sheet, then closes it', async () => {
  const order: string[] = [];
  const share = jest.spyOn(Share, 'share').mockImplementation(async () => (order.push('share'), { action: 'sharedAction', activityType: undefined }));
  await render(<RoomMenu id={M} visible onClose={() => order.push('close')} onLeft={noop} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Share link' }));
  await act(async () => undefined);
  expect(order).toEqual(['share', 'close']);
  expect(share).toHaveBeenCalledWith({ message: `https://gno.world/#r/${M}` });
  share.mockRestore();
});

test('Leave leaves and goes back to Public', async () => {
  const onLeft = jest.fn();
  await render(<RoomMenu id={A} visible onClose={noop} onLeft={onLeft} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Leave' }));
  await act(async () => undefined);
  expect(mockS.book().left[A]).toBeGreaterThan(0);
  expect(onLeft).toHaveBeenCalled();
});

test('Listed publicly shows the room\'s state and flips it', async () => {
  let set: unknown;
  mockS.client.setRoom = async (_id, _k, p) => ((set = p), {});
  await render(<RoomMenu id={M} visible onClose={noop} onLeft={noop} />);
  expect(await screen.findByText('on')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Listed publicly' }));
  expect(set).toEqual({ listed: false });
});

test('Listed publicly says nothing of another room until the server answers for it, and does not flip meanwhile', async () => {
  const K = 'KKKKKKKKKKKKKKKKKKKK';
  mockS.rooms.setState({ book: { rooms: [{ id: K, name: 'other', key: 'k2', at: 3 }, ...mockS.rooms.getState().book.rooms], left: {} } });
  let set: unknown;
  mockS.client.setRoom = async (_id, _k, p) => ((set = p), {});
  const view = await render(<RoomMenu id={M} visible onClose={noop} onLeft={noop} />);
  expect(await screen.findByText('on')).toBeTruthy();
  mockS.client.info = () => new Promise(() => undefined); // K's answer never comes
  await view.rerender(<RoomMenu id={K} visible onClose={noop} onLeft={noop} />);
  expect(screen.queryByText('on')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Listed publicly' }));
  expect(set).toBeUndefined();
});

test('a listed room not joined: Share link and Pair with a browser only (nothing to rename or leave)', async () => {
  const L = 'LLLLLLLLLLLLLLLLLLLL';
  mockS.rooms.setState({ listed: [{ id: L, name: 'governance', here: 4, made: 1 }] });
  await render(<RoomMenu id={L} visible onClose={noop} onLeft={noop} />);
  expect(labels()).toEqual(['Share link', 'Pair with a browser']);
});
