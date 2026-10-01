import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { colors, radius, space } from '@/theme';

import { Button } from './button';

export function CommandBlock({ command, qr = true }: { command: string; qr?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ gap: space.m }}>
      <Text selectable style={styles.code}>{command}</Text>
      <Button
        kind="secondary" title={copied ? 'Copied' : 'Copy'}
        onPress={async () => {
          await Clipboard.setStringAsync(command);
          setCopied(true);
        }}
      />
      {qr ? (
        <View style={styles.qr}>
          <QRCode value={command} size={240} backgroundColor="#fff" color="#000" ecl="L" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  code: { color: colors.fg, fontFamily: 'Menlo', fontSize: 12, backgroundColor: '#000', padding: space.m, borderRadius: radius.s },
  qr: { alignSelf: 'center', padding: space.m, backgroundColor: '#fff', borderRadius: radius.s },
});
