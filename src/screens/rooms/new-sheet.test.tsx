import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Share } from 'react-native';
import { useStore as mockUseStore } from 'zustand';

import { OffchainError } from '@/offchain/http';
import { screenServices } from '@/screens/channels/testing';
import { NewRoomSheet } from '@/screens/rooms/new-sheet';

const A = 'AAAAAAAAAAAAAAAAAAAA';
const N = 'NNNNNNNNNNNNNNNNNNNN';
let mockS: ReturnType<typeof screenServices>;

jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@/state/app-services', () => ({
  useServices: () => mockS,
  useRooms: <T,>(sel: (s: ReturnType<typeof mockS.rooms.getState>) => T) => mockUseStore(mockS.rooms, sel),
}));
jest.mock('@/state/settings', () => ({ useSettings: <T,>(sel: (s: { offchainUrl: string }) => T) => sel({ offchainUrl: 'https://gno.world' }) }));

const listed = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `room${String(i).padStart(16, '0')}`, name: `room ${i}`, here: i % 2, made: i }));

beforeEach(async () => {
  jest.mocked(router.back).mockClear();
  mockS = screenServices({ book: { rooms: [{ id: A, name: 'Dev chat', key: '', at: 1 }], left: {} }, listed: [{ id: A, name: 'Dev chat', here: 3, made: 1 }] });
  await mockS.ready;
});

test('Make makes the room, selects it in Chat and opens the share sheet', async () => {
  const order: string[] = [];
  const share = jest.spyOn(Share, 'share').mockImplementation(async () => (order.push('share'), { action: 'sharedAction', activityType: undefined }));
  jest.mocked(router.back).mockImplementation(() => void order.push('back'));
  let asked: unknown[] = [];
  mockS.client.make = async (...a) => ((asked = a), { id: N, name: 'tea', key: 'k1' });
  await render(<NewRoomSheet />);
  await fireEvent.changeText(screen.getByPlaceholderText('a name for a new room'), 'tea');
  await fireEvent(screen.getByRole('switch'), 'valueChange', true);
  await fireEvent.press(screen.getByRole('button', { name: 'Make' }));
  expect(asked).toEqual(['tea', true]);
  expect(mockS.chatChannel.getState().current).toBe(N);
  expect(share).toHaveBeenCalledWith({ message: `https://gno.world/#r/${N}` });
  expect(order).toEqual(['share', 'back']); // over the sheet, before it closes
  share.mockRestore();
  jest.mocked(router.back).mockReset();
});

// the share sheet covers only the bottom of the screen: Make stays in reach above it
test('Make cannot be pressed again while the share sheet is up', async () => {
  const share = jest.spyOn(Share, 'share').mockImplementation(() => new Promise(() => undefined));
  let made = 0;
  mockS.client.make = async () => (made++, { id: N, name: 'tea', key: 'k1' });
  await render(<NewRoomSheet />);
  await fireEvent.changeText(screen.getByPlaceholderText('a name for a new room'), 'tea');
  await fireEvent.press(screen.getByRole('button', { name: 'Make' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Make' }));
  expect(made).toBe(1);
  share.mockRestore();
});

test('a refused Make shows the server\'s words', async () => {
  mockS.client.make = async () => {
    throw new OffchainError(429, 'slow down — one room a minute');
  };
  await render(<NewRoomSheet />);
  await fireEvent.changeText(screen.getByPlaceholderText('a name for a new room'), 'tea');
  await fireEvent.press(screen.getByRole('button', { name: 'Make' }));
  expect(screen.getByText('slow down — one room a minute')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
});

test('Join with a link selects the room; junk says it is not a room link', async () => {
  mockS.client.info = async () => ({ id: N, name: 'party', listed: false, here: 1, made: 1 });
  await render(<NewRoomSheet />);
  await fireEvent.changeText(screen.getByPlaceholderText('or paste a room\'s link'), 'nope');
  await fireEvent.press(screen.getByRole('button', { name: 'Join' }));
  expect(screen.getByText('that is not a room link')).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText('or paste a room\'s link'), `https://gno.world/#r/${N}`);
  await fireEvent.press(screen.getByRole('button', { name: 'Join' }));
  expect(mockS.chatChannel.getState().current).toBe(N);
  expect(router.back).toHaveBeenCalled();
});

test('Public rooms lists the listed rooms with who is there, and open for joined ones; a row opens it in Chat', async () => {
  mockS.client.listPublic = async () => [{ id: A, name: 'Dev chat', here: 3, made: 1 }, { id: N, name: 'quiet', here: 0, made: 2 }];
  await render(<NewRoomSheet />);
  expect(screen.getByText('Public rooms')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Dev chat, 3 here, open' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'quiet, empty' }));
  expect(mockS.chatChannel.getState().current).toBe(N);
  expect(router.back).toHaveBeenCalled();
});

test('a search field shows from 9 rooms', async () => {
  mockS.client.listPublic = async () => listed(8);
  const view = await render(<NewRoomSheet />);
  expect(screen.queryByPlaceholderText('search')).toBeNull();
  await view.unmount();
  mockS.client.listPublic = async () => listed(9);
  await render(<NewRoomSheet />);
  await fireEvent.changeText(screen.getByPlaceholderText('search'), 'room 7');
  expect(screen.getAllByRole('button', { name: /^room \d/ }).map((b) => b.props.accessibilityLabel)).toEqual(['room 7, 1 here']);
});

test('none right now; could not be listed right now', async () => {
  mockS.client.listPublic = async () => [];
  mockS.rooms.setState({ listed: [] });
  const view = await render(<NewRoomSheet />);
  expect(screen.getByText('none right now — make one and list it')).toBeTruthy();
  await view.unmount();
  mockS.client.listPublic = async () => {
    throw new Error('down');
  };
  await render(<NewRoomSheet />);
  expect(await screen.findByText('could not be listed right now')).toBeTruthy();
});
