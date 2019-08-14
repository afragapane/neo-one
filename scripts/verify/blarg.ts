import { NEOONEDataProvider } from '@neo-one/client-core';

const oneRPCURL = 'http://localhost:40200/rpc';
const oneProvider = new NEOONEDataProvider({
  network: 'test',
  rpcURL: oneRPCURL,
});

oneProvider.getBlockCount().then((count) => console.log(count));
