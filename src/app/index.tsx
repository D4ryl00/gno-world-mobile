import { useGnoNativeContext } from '@gnolang/gnonative';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

const BR5 = 'gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble5';

export default function Index() {
  const { gnonative } = useGnoNativeContext();
  const [out, setOut] = useState('');
  useEffect(() => {
    gnonative
      .render(BR5, 'json')
      .then((s) => setOut((o) => `${o} / pools: ${JSON.parse(s).pools.length}`))
      .catch((e) => setOut((o) => `${o} / error: ${String(e)}`));
    gnonative
      .signBytes(new Uint8Array(20), new Uint8Array())
      .then(() => setOut((o) => o + ' / signBytes: unexpected success'))
      .catch((e) => setOut((o) => o + ` / signBytes reachable (${String(e)})`));
  }, [gnonative]);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Text style={{ flexShrink: 1 }}>{out}</Text>
    </View>
  );
}
