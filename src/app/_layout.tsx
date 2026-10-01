import { GnoNativeProvider } from '@gnolang/gnonative';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <GnoNativeProvider config={{ remote: 'https://rpc.gno.land:443', chain_id: 'gnoland-1' }}>
      <Stack />
    </GnoNativeProvider>
  );
}
