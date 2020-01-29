import { StorageItem } from '@neo-one/node-core';
import { BN } from 'bn.js';

export class Nep5AccountState {
  private mutableBalance: BN;

  public constructor(data: StorageItem | undefined) {
    this.mutableBalance = data === undefined ? new BN(0) : new BN(data.value);
  }

  public get balance(): BN {
    return this.mutableBalance;
  }

  public updateBalance(amount: BN) {
    this.mutableBalance = this.mutableBalance.add(amount);
  }
}
