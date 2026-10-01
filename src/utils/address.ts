export const isAddress = (a: string) => /^g1[a-z0-9]{38}$/.test(a);

/** g1leu8d2v…95wr, like the site. */
export const shortAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a || '');
