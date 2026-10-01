import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { GnoNativeService } from '@gnolang/gnonative/build/api/vendor/rpc_pb';

import type { ChainApi } from '../src/chain/api';

/** ChainApi over gnonative's goserver (TCP), mirroring GnoNativeApi's wrappers. */
export function nodeChainApi(baseUrl: string): ChainApi {
  const c = createClient(GnoNativeService, createConnectTransport({ baseUrl, httpVersion: '1.1' }));
  return {
    setRemote: (remote) => c.setRemote({ remote }),
    setChainID: (chainId) => c.setChainID({ chainId }),
    render: async (packagePath, args) => (await c.render({ packagePath, args })).result,
    call: async (packagePath, fnc, args, gasFee, gasWanted, signerAddress, send) =>
      c.call({ gasFee, gasWanted, signerAddress, msgs: [{ packagePath, fnc, args, send }] }),
    queryAccount: (address) => c.queryAccount({ address }),
    querySessionAccount: (masterAddress, sessionAddress) => c.querySessionAccount({ masterAddress, sessionAddress }),
    generateRecoveryPhrase: async () => (await c.generateRecoveryPhrase({})).phrase,
    createAccount: async (nameOrBech32, mnemonic, password) => (await c.createAccount({ nameOrBech32, mnemonic, password })).key,
    activateAccount: (nameOrBech32, master) => c.activateAccount(master ? { nameOrBech32, master } : { nameOrBech32 }),
    setPassword: (password, address) => c.setPassword({ password, address }),
    signBytes: (address, data) => c.signBytes({ address, data }),
  };
}
