import type { AppStateStatus } from 'react-native';

/**
 * The chat polls while the app is in front. "inactive" (Notification Center, a permission alert, a system sheet)
 * keeps it running; only "background" stops it, and coming back resumes from the cursor.
 */
export function followAppState(st: AppStateStatus, chat: { start(): void; stop(): void }): void {
  if (st === 'active') chat.start();
  else if (st === 'background') chat.stop();
}
