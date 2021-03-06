const { disableConsoleLogForTest } = require('@neo-one/client-switch');
const { setGlobalLogLevel } = require('@neo-one/logger');

disableConsoleLogForTest();
setGlobalLogLevel('silent');
jest.setTimeout(60 * 1000);

afterEach(async () => {
  await one.cleanupTest();
});
