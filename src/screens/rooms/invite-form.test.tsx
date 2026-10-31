import { fireEvent, render, screen } from '@testing-library/react-native';

import { screenServices } from '@/screens/channels/testing';
import { InviteForm } from '@/screens/rooms/invite-form';

const M = 'MMMMMMMMMMMMMMMMMMMM';
let mockS: ReturnType<typeof screenServices>;
jest.mock('@/state/app-services', () => ({ useServices: () => mockS }));

beforeEach(async () => {
  mockS = screenServices({ book: { rooms: [{ id: M, name: 'my room', key: 'k1', at: 2 }], left: {} } });
  await mockS.ready;
});

test('a name and an optional four-hex tag; success says when they get it; a bad tag is refused before sending', async () => {
  const sent: unknown[][] = [];
  mockS.client.invite = async (...a) => (sent.push(a), { to: a[2] });
  await render(<InviteForm id={M} />);
  expect(screen.getByText('with two bobs, add the four-letter tag')).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText('their name'), 'bob');
  await fireEvent.changeText(screen.getByPlaceholderText('tag'), 'xyz');
  await fireEvent.press(screen.getByRole('button', { name: 'Invite' }));
  expect(sent).toEqual([]);
  expect(screen.getByText('a tag is four letters 0-9 and a-f')).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText('tag'), 'AB12');
  await fireEvent.press(screen.getByRole('button', { name: 'Invite' }));
  expect(sent).toEqual([[M, 'k1', 'bob', 'ab12']]);
  expect(screen.getByText('bob gets "my room" on their next poll')).toBeTruthy();
});
