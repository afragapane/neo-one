import { Client, DeveloperClient } from '@neo-one/client';
import * as React from 'react';
import { Link, styled } from 'reakit';
import { prop } from 'styled-tools';
import { FromStream } from '../FromStream';
import { WithAutoConsensus, WithNetworkClient } from './DeveloperToolsContext';
import { AddToast, WithAddToast } from './ToastsContainer';
import { AddError, WithAddError } from './WithAddError';
import { WithNEOTrackerURL } from './WithNEOTrackerURL';

const mutableHookers = new Map<Client, Hooker>();

export const StyledLink = styled(Link)`
  color: ${prop('theme.accent')};
  opacity: 0.9;
  ${prop('theme.fonts.axiformaRegular')};
  font-size: 14px;

  &:hover {
    opacity: 1;
    text-decoration: none;
  }
`;

class Hooker {
  public static get(client: Client): Hooker {
    let hooker = mutableHookers.get(client);
    if (hooker === undefined) {
      hooker = new Hooker(client);
      mutableHookers.set(client, hooker);
    }

    return hooker;
  }

  private mutableAutoConsensus = false;
  private mutableDeveloperClient: DeveloperClient | undefined;
  private mutableAddToast: AddToast | undefined;
  private mutableAddError: AddError | undefined;
  private mutableNEOTrackerURL: string | undefined;

  private constructor(client: Client) {
    client.hooks.beforeConfirmed.tapPromise('AutoConsensus', async () => {
      if (this.mutableAutoConsensus && this.mutableDeveloperClient !== undefined) {
        await this.mutableDeveloperClient.runConsensusNow();
      }
    });
    client.hooks.relayError.tap('RelayErrorToast', (error) => {
      if (this.mutableAddError !== undefined) {
        this.mutableAddError(error);
      }
    });
    client.hooks.confirmedError.tap('ConfirmedErrorToast', (_transaction, error) => {
      if (this.mutableAddError !== undefined) {
        this.mutableAddError(error);
      }
    });
    client.hooks.afterConfirmed.tap('TransactionToast', (transaction) => {
      if (this.mutableAddToast !== undefined && this.mutableNEOTrackerURL !== undefined) {
        this.mutableAddToast({
          id: transaction.hash,
          title: <span data-test="neo-one-transaction-toast-title">Transaction Confirmed</span>,
          message: (
            <span data-test="neo-one-transaction-toast-message">
              View on&nbsp;
              <StyledLink
                data-test="neo-one-transaction-toast-link"
                href={`${this.mutableNEOTrackerURL}/tx/${transaction.hash.slice(2)}`}
                target="_blank"
              >
                NEO Tracker
              </StyledLink>
            </span>
          ),
          autoHide: 5000,
        });
      }
    });
  }

  public set autoConsensus(value: boolean) {
    this.mutableAutoConsensus = value;
  }

  public set developerClient(value: DeveloperClient | undefined) {
    this.mutableDeveloperClient = value;
  }

  public set addToast(value: AddToast) {
    this.mutableAddToast = value;
  }

  public set addError(value: AddError) {
    this.mutableAddError = value;
  }

  public set neotrackerURL(value: string | undefined) {
    this.mutableNEOTrackerURL = value;
  }
}

export function ClientHook() {
  return (
    <WithAddToast>
      {(addToast) => (
        <WithAddError>
          {(addError) => (
            <WithNetworkClient>
              {({ client, developerClient }) => (
                <WithNEOTrackerURL>
                  {(neotrackerURL) => (
                    <WithAutoConsensus>
                      {({ autoConsensus$ }) => (
                        <FromStream props$={autoConsensus$}>
                          {(autoConsensus) => {
                            const mutableHooker = Hooker.get(client);
                            mutableHooker.autoConsensus = autoConsensus;
                            mutableHooker.developerClient = developerClient;
                            mutableHooker.addToast = addToast;
                            mutableHooker.neotrackerURL = neotrackerURL;
                            mutableHooker.addError = addError;

                            // tslint:disable-next-line no-null-keyword
                            return null;
                          }}
                        </FromStream>
                      )}
                    </WithAutoConsensus>
                  )}
                </WithNEOTrackerURL>
              )}
            </WithNetworkClient>
          )}
        </WithAddError>
      )}
    </WithAddToast>
  );
}
