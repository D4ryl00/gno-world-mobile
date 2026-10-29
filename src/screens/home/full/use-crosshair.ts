import { useEffect, useState } from 'react';
import type { GestureResponderEvent, GestureResponderHandlers } from 'react-native';

/** One touch at a time, outside React: a move does not wait for a render. */
function createCrosshair(holdMs: number, slop: number) {
  let onPick: (px: number | null) => void = () => {};
  let active = false;
  let x = 0;
  let start = { pageX: 0, pageY: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;

  const end = () => {
    clearTimeout(timer);
    timer = undefined;
    if (active) onPick(null);
    active = false;
  };
  const responder: GestureResponderHandlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      const { locationX, pageX, pageY } = e.nativeEvent;
      active = false;
      x = locationX;
      start = { pageX, pageY };
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        active = true;
        onPick(x);
      }, holdMs);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const { locationX, pageX, pageY } = e.nativeEvent;
      x = locationX;
      if (active) return onPick(x);
      // moved before the hold: a swipe, let it go
      if (timer && Math.hypot(pageX - start.pageX, pageY - start.pageY) > slop) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    onResponderTerminationRequest: () => !active,
    onResponderRelease: end,
    onResponderTerminate: end,
  };
  return {
    responder,
    setOnPick(f: (px: number | null) => void) {
      onPick = f;
    },
  };
}

/**
 * Hold, then slide: the touch becomes a crosshair only after `holdMs` without moving more than `slop`, so a quick
 * swipe still scrolls or closes the sheet. `onPick` gets the finger's x in the view, then null when it lifts.
 * The view's children must not take touches (pointerEvents="none"), or x is relative to them.
 */
export function useCrosshair({ holdMs = 200, slop = 8, onPick }: { holdMs?: number; slop?: number; onPick(px: number | null): void }): {
  responder: GestureResponderHandlers;
} {
  const [c] = useState(() => createCrosshair(holdMs, slop));
  useEffect(() => c.setOnPick(onPick));
  return { responder: c.responder };
}
