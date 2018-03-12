/* @flow */
import type { Blockchain } from '@neo-one/node-core';

import _ from 'lodash';
import fetch from 'node-fetch';

const fetchCount = async (
  endpoint: string,
  timeoutMS: number,
): Promise<?number> => {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          method: 'getblockcount',
          params: [],
          id: 4,
        },
      ]),
      timeout: timeoutMS,
    });
    if (!response.ok) {
      return null;
    }
    const result = await response.json();
    if (Array.isArray(result)) {
      const responseJSON = result[0];
      if (responseJSON.error || responseJSON.result == null) {
        return null;
      }
      return responseJSON.result;
    }

    return null;
  } catch (error) {
    return null;
  }
};

const CHECK_ENDPOINTS = 5;

const fetchTallestBlockIndex = async (
  rpcEndpoints: Array<string>,
  timeoutMS: number,
  checkEndpoints?: number,
): Promise<?number> => {
  const counts = await Promise.all(
    _.take(
      _.shuffle(rpcEndpoints),
      checkEndpoints == null ? CHECK_ENDPOINTS : checkEndpoints,
    ).map(rpcEndpoint => fetchCount(rpcEndpoint, timeoutMS)),
  );
  return _.max(counts.filter(Boolean).map(count => count - 1));
};

export type Options = {|
  rpcURLs: Array<string>,
  offset: number,
  timeoutMS: number,
  checkEndpoints?: number,
|};

export default async ({
  blockchain,
  options,
}: {|
  blockchain: Blockchain,
  options: Options,
|}) => {
  const index = await fetchTallestBlockIndex(
    options.rpcURLs,
    options.timeoutMS,
    options.checkEndpoints,
  );
  const ready =
    options.rpcURLs.length === 0 ||
    index == null ||
    blockchain.currentBlockIndex >= index - options.offset;

  return { ready, index };
};
