import { ImageManipulator } from 'expo-image-manipulator';

import { AVATAR_PX, avatarJpeg } from '@/screens/chat/avatar';

jest.mock('expo-image-manipulator', () => {
  const ctx = { resize: jest.fn(), renderAsync: jest.fn(async () => ({ saveAsync: jest.fn(async () => ({ base64: 'AQID' })) })) };
  ctx.resize.mockReturnValue(ctx);
  return { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate: jest.fn(() => ctx) } };
});

test('the picked photo becomes a 256 px JPEG, as bytes', async () => {
  expect(await avatarJpeg('file:///photo.heic')).toEqual(new Uint8Array([1, 2, 3]));
  expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file:///photo.heic');
  const ctx = (ImageManipulator.manipulate as jest.Mock).mock.results[0].value;
  expect(ctx.resize).toHaveBeenCalledWith({ width: AVATAR_PX });
});
