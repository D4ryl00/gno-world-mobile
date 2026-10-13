// The test page: a web producer that holds its own session key and has an in-page
// wallet grant, renew and revoke it. Each answer is printed as one JSON line in
// #out and pushed to window.results, which the Playwright bench reads.
import { secp256k1 } from './vendor/noble-secp256k1.js';
import { addressFromKey, gpubFromKey, pubFromGpub, sha256, signRequest } from './session-request.js';

const params = new URLSearchParams(location.search);
const KEY_TYPE = params.get('key') === 'secp256k1' ? 'secp256k1' : 'ed25519';
const CHAIN_ID = params.get('chainid') || 'dev';
const RPC = params.get('rpc') || 'http://127.0.0.1:26657';
const GRANT = { allow: ['vm/exec:gno.land/r/demo/inpage'], spend: '5000000ugnot', period: 3600, expires: 86400 };
const TEST1 = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';

window.results = [];
const out = document.getElementById('out');
const stateBox = document.getElementById('state');

function record(action, entry) {
  const line = { action, ...entry };
  window.results.push(line);
  out.textContent = `${JSON.stringify(line)}\n${out.textContent}`;
  return line;
}

// --- the wallet: discovery per the standard, or a legacy stub that ignores keys

let wallet = null;

function legacyWallet() {
  const account = { address: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5', chainid: CHAIN_ID, pubkey: null };
  return {
    info: { name: 'Legacy (ignores pubkey)', rdns: 'test.legacy' },
    provider: {
      connect: async () => ({ status: 'Approved', args: account }),
      on: () => () => undefined,
    },
  };
}

function discover() {
  if (params.get('wallet') === 'legacy') {
    wallet = legacyWallet();
    render();
    return;
  }
  window.addEventListener('gno:registerWallet', (event) => {
    if (!wallet) {
      wallet = event.detail;
      wallet.provider.on?.('disconnect', () => record('event', { event: 'disconnect' }));
      render();
    }
  });
  window.dispatchEvent(new Event('gno:requestWallet'));
}

// --- keys: Ed25519 as a non-extractable WebCrypto key (the CryptoKey object is
// stored, never its bytes), or secp256k1 bytes, which JavaScript can always read.

const DB = 'inpage-sessions';

function db() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keys');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function store(op, ...args) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('keys', op === 'get' ? 'readonly' : 'readwrite');
    const req = tx.objectStore('keys')[op](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const slot = (name) => `${KEY_TYPE}:${name}`;

async function newKey() {
  if (KEY_TYPE === 'ed25519') {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return { type: 'ed25519', privateKey: pair.privateKey, raw };
  }
  const priv = secp256k1.utils.randomPrivateKey();
  return { type: 'secp256k1', priv, raw: secp256k1.getPublicKey(priv, true) };
}

function signerOf(key) {
  if (key.type === 'ed25519') {
    return async (data) => new Uint8Array(await crypto.subtle.sign('Ed25519', key.privateKey, data));
  }
  return async (data) => secp256k1.sign(sha256(data), key.priv).toCompactRawBytes();
}

const gpub = (key) => gpubFromKey(key.type, key.raw);
const address = (key) => addressFromKey(key.type, key.raw);

async function currentKey() {
  let key = await store('get', slot('current'));
  if (!key) {
    key = await newKey();
    await store('put', key, slot('current'));
  }
  return key;
}

// --- requests

let identity = localStorage.getItem('identity') || '';
const now = () => Math.floor(Date.now() / 1000);
const freshState = () => crypto.randomUUID();

async function grantRequest(key, extra = {}) {
  const fields = { pubkey: gpub(key), ...GRANT, chainid: CHAIN_ID, state: freshState(), iat: now(), ...extra };
  if (identity && !fields.signer) fields.signer = identity;
  return signRequest('connect', fields, signerOf(key));
}

/** `auth/accounts/<master>/session/<addr>` through the node's abci_query. */
async function onChain(master, session) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'abci_query',
      params: { path: `auth/accounts/${master}/session/${session}`, data: '' },
    }),
  });
  const data = (await res.json())?.result?.response?.ResponseBase?.Data;
  if (!data) return null;
  const parsed = JSON.parse(atob(data));
  const s = parsed.BaseSessionAccount ?? parsed;
  return {
    expiresAt: Number(s.expires_at ?? 0),
    allow: parsed.allow_paths ?? [],
    spend: s.spend_limit ?? '',
    period: Number(s.spend_period ?? 0),
  };
}

/** A grant counts only if `session` is this key's address. */
async function reportConnect(action, key, answer) {
  const args = answer.args ?? {};
  if (args.address) {
    identity = args.address;
    localStorage.setItem('identity', identity);
  }
  const granted = answer.status === 'Approved' && !!key && args.session === address(key);
  const chain = key && identity ? await onChain(identity, address(key)) : null;
  return record(action, {
    status: answer.status,
    code: answer.code,
    granted,
    session: args.session,
    revoked: args.revoked,
    hash: args.hash,
    key: key ? address(key) : undefined,
    onChain: chain,
  });
}

async function reportDisconnect(action, key, answer) {
  const args = answer.args ?? {};
  const revoked = answer.status === 'Approved' && !!key && args.revoked === address(key);
  const chain = key && identity ? await onChain(identity, address(key)) : null;
  return record(action, { status: answer.status, code: answer.code, revoked, key: key ? address(key) : undefined, onChain: chain });
}

// gno.world's signBytesOf (app-panels.js): sorted JSON, <>& escaped, as std.SignDataPayload writes it.
const sortedObject = (t) =>
  typeof t !== 'object' || t === null
    ? t
    : Array.isArray(t)
      ? t.map(sortedObject)
      : Object.keys(t).sort().reduce((o, k) => ((o[k] = sortedObject(t[k])), o), {});
const signBytesOf = (t) =>
  JSON.stringify(sortedObject(t)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

const actions = {
  /** What gno.world's page would do: a phrase from the server, signed through connect, sent back. */
  async reserveByProof() {
    const { words } = await (await fetch('/api/name/challenge', { cache: 'no-store' })).json();
    const answer = await wallet.provider.connect({ challenge: words, signer: TEST1, chainid: CHAIN_ID });
    if (answer.status !== 'Approved') return record('reserveByProof', { status: answer.status, code: answer.code });
    const { address, chainid, features, proof, pubkey, session } = answer.args;
    const res = await fetch('/api/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bench',
        doc: signBytesOf(proof.signed),
        sig: proof.signature,
        pub: base64(pubFromGpub(pubkey)),
        addr: address,
      }),
    });
    const body = await res.json();
    return record('reserveByProof', { status: answer.status, chainid, features, session, reserved: res.ok, error: body.error });
  },
  async proveAgain() {
    const answer = await wallet.provider.connect({ challenge: 'example.com: again', chainid: CHAIN_ID });
    return record('proveAgain', { status: answer.status, code: answer.code });
  },
  async provePinOther() {
    const answer = await wallet.provider.connect({ challenge: 'example.com: pin', signer: 'g1qynsu9dwj9lq0m5fkje7jh6qy3md80ztqnshhm', chainid: CHAIN_ID });
    return record('provePinOther', { status: answer.status, code: answer.code });
  },
  async proveBadText() {
    const answer = await wallet.provider.connect({ challenge: 'example.com:\u0085bad', chainid: CHAIN_ID });
    return record('proveBadText', { status: answer.status, code: answer.code });
  },
  async grant() {
    const key = await currentKey();
    return reportConnect('grant', key, await wallet.provider.connect(await grantRequest(key)));
  },
  async grantAgain() {
    const key = await currentKey();
    return reportConnect('grantAgain', key, await wallet.provider.connect(await grantRequest(key)));
  },
  async renew() {
    const old = await currentKey();
    const key = await newKey();
    const fields = { pubkey: gpub(key), old: gpub(old), ...GRANT, chainid: CHAIN_ID, signer: identity, state: freshState(), iat: now() };
    const req = await signRequest('connect', fields, signerOf(key), signerOf(old));
    const answer = await wallet.provider.connect(req);
    if (answer.status === 'Approved' && answer.args?.session === address(key)) {
      await store('put', old, slot('previous'));
      await store('put', key, slot('current'));
    }
    const line = await reportConnect('renew', key, answer);
    line.oldOnChain = await onChain(identity, address(old));
    line.old = address(old);
    return line;
  },
  async disconnectWithKey() {
    const key = await currentKey();
    const fields = { pubkey: gpub(key), chainid: CHAIN_ID, signer: identity, state: freshState(), iat: now() };
    const req = await signRequest('disconnect', fields, signerOf(key));
    return reportDisconnect('disconnectWithKey', key, await wallet.provider.disconnect(req));
  },
  async disconnect() {
    const key = await currentKey();
    return reportDisconnect('disconnect', key, await wallet.provider.disconnect());
  },
  async plainConnect() {
    return reportConnect('plainConnect', null, await wallet.provider.connect());
  },
  async badProof() {
    const key = await currentKey();
    const req = await grantRequest(key);
    return reportConnect('badProof', key, await wallet.provider.connect({ ...req, spend: '9000000ugnot' }));
  },
  async stale() {
    const key = await currentKey();
    return reportConnect('stale', key, await wallet.provider.connect(await grantRequest(key, { iat: now() - 660 })));
  },
  async oldIsPubkey() {
    const key = await currentKey();
    const fields = { pubkey: gpub(key), old: gpub(key), ...GRANT, chainid: CHAIN_ID, signer: identity, state: freshState(), iat: now() };
    const req = await signRequest('connect', fields, signerOf(key), signerOf(key));
    return reportConnect('oldIsPubkey', key, await wallet.provider.connect(req));
  },
  /** Whether this origin is still approved: a gated read never prompts. */
  async account() {
    try {
      const answer = await wallet.provider.getAccount();
      return record('account', { status: answer.status, approved: answer.status === 'Approved' });
    } catch (error) {
      return record('account', { approved: false, code: error?.code });
    }
  },
  async resetKeys() {
    await store('delete', slot('current'));
    await store('delete', slot('previous'));
    return record('resetKeys', {});
  },
};

async function render() {
  const key = await store('get', slot('current'));
  stateBox.textContent = [
    `wallet: ${wallet ? wallet.info.name : 'none'}`,
    `key type: ${KEY_TYPE}${KEY_TYPE === 'ed25519' ? ' (WebCrypto, non-extractable)' : ' (bytes readable by JavaScript)'}`,
    `key: ${key ? address(key) : 'none yet'}`,
    `identity: ${identity || 'unknown'}`,
    `chain: ${CHAIN_ID} via ${RPC}`,
  ].join('\n');
}

/** For the bench: run one action and resolve with its line. */
window.runAction = async (name) => {
  try {
    return await actions[name]();
  } catch (error) {
    return record(name, { error: String(error?.message ?? error), code: error?.code });
  } finally {
    render();
  }
};

document.getElementById('buttons').addEventListener('click', (event) => {
  const name = event.target?.dataset?.action;
  if (name) window.runAction(name);
});

discover();
render();
