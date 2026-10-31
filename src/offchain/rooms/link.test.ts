import { parseRoomLink, roomLink } from '@/offchain/rooms/link';

const ID = 'Ab3_-Ab3_-Ab3_-Ab3_-';

test('a room link, with or without the site\'s extras, or a bare id, gives the id', () => {
  expect(parseRoomLink(`https://gno.world/#r/${ID}`)).toBe(ID);
  expect(parseRoomLink(`https://gno.world/#r/${ID}&ref=g1abc`)).toBe(ID);
  expect(parseRoomLink(`  ${ID}  `)).toBe(ID);
  expect(parseRoomLink(` https://gno.world/#r/${ID}\n`)).toBe(ID);
});

test('anything else is not a room link', () => {
  expect(parseRoomLink('https://gno.world/')).toBeNull();
  expect(parseRoomLink(ID.slice(1))).toBeNull();
  expect(parseRoomLink('https://gno.world/#rumble/3')).toBeNull();
  expect(parseRoomLink('')).toBeNull();
});

test('a room\'s link is the site\'s', () => {
  expect(roomLink('https://gno.world/', ID)).toBe(`https://gno.world/#r/${ID}`);
});
