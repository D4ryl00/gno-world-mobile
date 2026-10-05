import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Avatars show at a few dozen pixels: a camera photo is cut down before it is sent. */
export const AVATAR_PX = 256;

/** The picked photo as a JPEG AVATAR_PX wide, in bytes (read from base64: no Response.blob() round trip). */
export async function avatarJpeg(uri: string): Promise<Uint8Array> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: AVATAR_PX }).renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!out.base64) throw new Error('the picture came back empty');
  return Uint8Array.from(atob(out.base64), (c) => c.charCodeAt(0));
}
