/**
 * What the terminal window shows: gnokey-pair's output without its QR (block characters, or ANSI-coloured blank
 * lines — it is for a camera, not for the video), without colour codes and runs of blank lines, its last 22 lines.
 */
export function terminalText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => !/[█▀▄]/.test(l) && !/^(\x1b\[[0-9;]*m)+\s*(\x1b\[0m)?\s*$/.test(l))
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .slice(-22)
    .join('\n');
}
