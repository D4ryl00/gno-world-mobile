import { act, renderHook } from '@testing-library/react-native';
import type { GestureResponderEvent } from 'react-native';

import { useCrosshair } from '@/screens/home/full/use-crosshair';

const at = (x: number, y = 100) => ({ nativeEvent: { locationX: x, locationY: y, pageX: x, pageY: y } }) as unknown as GestureResponderEvent;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('hold, then slide: the finger is followed; letting go clears', async () => {
  const onPick = jest.fn();
  const { result } = await renderHook(() => useCrosshair({ onPick }));
  const r = result.current.responder;
  await act(async () => void r.onResponderGrant!(at(50)));
  expect(onPick).not.toHaveBeenCalled();
  await act(async () => void jest.advanceTimersByTime(200));
  expect(onPick).toHaveBeenLastCalledWith(50); // shown under the finger at once
  expect(r.onResponderTerminationRequest!(at(50))).toBe(false); // the sheet does not take it back
  await act(async () => void r.onResponderMove!(at(120, 140)));
  expect(onPick).toHaveBeenLastCalledWith(120);
  await act(async () => void r.onResponderRelease!(at(120)));
  expect(onPick).toHaveBeenLastCalledWith(null);
});

test('moving before the hold is a swipe, not a crosshair', async () => {
  const onPick = jest.fn();
  const { result } = await renderHook(() => useCrosshair({ onPick }));
  const r = result.current.responder;
  await act(async () => void r.onResponderGrant!(at(50)));
  await act(async () => void r.onResponderMove!(at(50, 120)));
  expect(r.onResponderTerminationRequest!(at(50))).toBe(true);
  await act(async () => void jest.advanceTimersByTime(500));
  await act(async () => void r.onResponderMove!(at(80, 130)));
  expect(onPick).not.toHaveBeenCalled();
});
