import { loadConfiguration } from '@neo-one/cli-common-node';
import { bodyParser } from '@neo-one/http';
import { Blockchain, Node } from '@neo-one/node-core';
import { createHandler } from '@neo-one/node-rpc-handler';
import execa from 'execa';
import { Context } from 'koa';
import compose from 'koa-compose';
import koaCompress from 'koa-compress';

export const rpc = ({ blockchain, node }: { readonly blockchain: Blockchain; readonly node: Node }) => {
  const handler = createHandler({
    blockchain,
    node,
    handleGetProjectConfiguration: async () => loadConfiguration(),
    handleResetProject: async () => {
      await execa(process.argv[0], [process.argv[1], 'build', '--reset']);
    },
  });

  return {
    name: 'rpc',
    path: '/rpc',
    middleware: compose([
      koaCompress(),
      bodyParser(),
      async (ctx: Context): Promise<void> => {
        if (!ctx.is('application/json')) {
          return ctx.throw(415);
        }

        // tslint:disable-next-line no-any
        const { body } = ctx.request as any;
        const result = await handler(body);

        ctx.body = result;
      },
    ]),
  };
};
