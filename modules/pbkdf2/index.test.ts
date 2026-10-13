import { NO_MODULE, pbkdf2Sha256 } from '.';

const mockSha256Hex = jest.fn();
let mockAbsent = false;
// the module asks for its native half on import: the mock reads this file's state only when called
jest.mock('expo', () => ({
  requireOptionalNativeModule: () => (mockAbsent ? null : { sha256Hex: (...a: unknown[]) => mockSha256Hex(...a) }),
}));

test('the native hex answer comes back as bytes', async () => {
  mockSha256Hex.mockResolvedValueOnce('00ff10');
  expect(await pbkdf2Sha256('K7XQ2M', 'bubblerumble rooms K7XQ2M', 200000, 3)).toEqual(new Uint8Array([0, 255, 16]));
  expect(mockSha256Hex).toHaveBeenCalledWith('K7XQ2M', 'bubblerumble rooms K7XQ2M', 200000, 3);
});

test('an answer of the wrong length is refused', async () => {
  mockSha256Hex.mockResolvedValueOnce('00ff');
  await expect(pbkdf2Sha256('a', 'b', 1, 3)).rejects.toThrow('the key derivation answered nonsense');
});

test('without the native module, pairing says the build cannot pair', async () => {
  let isolated: typeof import('.') | undefined;
  mockAbsent = true;
  jest.isolateModules(() => {
    isolated = require('.');
  });
  await expect(isolated!.pbkdf2Sha256('a', 'b', 1, 32)).rejects.toThrow(NO_MODULE);
});
