import { subscribeTick } from '@/hooks/use-now';

test('every subscriber of an interval shares one timer, stopped with the last one', () => {
  jest.useFakeTimers();
  const setSpy = jest.spyOn(global, 'setInterval');
  const clearSpy = jest.spyOn(global, 'clearInterval');
  const a = jest.fn(), b = jest.fn();
  const offA = subscribeTick(1000, a);
  const offB = subscribeTick(1000, b);
  expect(setSpy).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1000);
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  offA();
  expect(clearSpy).not.toHaveBeenCalled();
  offB();
  expect(clearSpy).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
