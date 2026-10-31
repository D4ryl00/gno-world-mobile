import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useServices } from '@/state/app-services';

/** The room this screen shows long-polls while the screen has the focus ('' is Public, which always polls). */
export function useRoomOnScreen(id: string): void {
  const { rooms } = useServices();
  useFocusEffect(
    useCallback(() => {
      rooms.getState().focus(id);
      return () => rooms.getState().blur(id);
    }, [rooms, id]),
  );
}
