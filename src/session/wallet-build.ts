// A store build made before gnokey-mobile is in the stores sets EXPO_PUBLIC_WALLET=off (eas.json): sessions come from a
// computer, names from a boop or /pair. Remove this file and its uses once the wallet ships.
export const walletFromEnv = (v: string | undefined) => v !== 'off';

export const walletEnabled = walletFromEnv(process.env.EXPO_PUBLIC_WALLET);
