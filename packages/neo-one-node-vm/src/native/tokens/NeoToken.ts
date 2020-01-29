import { BinaryWriter, common, ECPoint } from '@neo-one/client-common';
import {
  BinaryReader,
  ContractParameterDeclaration,
  ContractParameterType,
  StorageFlags,
  StorageItem,
  utils,
  ValidatorsCount,
  ValidatorState,
} from '@neo-one/node-core';
import { BN } from 'bn.js';
import _ from 'lodash';
import { map, toArray } from 'rxjs/operators';
import { ExecutionContext, FEES, OpInvokeArgs } from '../../constants';
import { InvalidValidatorStorage, ValueNegativeError } from '../../errors';
import { ArrayStackItem, BooleanStackItem, ECPointStackItem, IntegerStackItem, StructStackItem } from '../../stackItem';
import { checkWitness } from '../../syscalls';
import { ContractMethodData, createStorageKey, NativeContractBase } from '../NativeContractBase';
import { Nep5AccountState } from './Nep5AccountState';
import { createAccountKey, Nep5Token } from './Nep5Token';

class NeoAccountState extends Nep5AccountState {
  public static votesFromBuffer(voteArray: Buffer): readonly ECPoint[] {
    const reader = new BinaryReader(voteArray);

    return reader.readArray(reader.readECPoint);
  }

  private readonly mutableBalanceHeight: BN;
  private mutableVotes: readonly ECPoint[];

  public constructor(data: StorageItem | undefined) {
    super(data);
    this.mutableBalanceHeight = new BN(0);
    this.mutableVotes = [];
  }

  public get height(): BN {
    return this.mutableBalanceHeight;
  }

  public get votes(): readonly ECPoint[] {
    return this.mutableVotes;
  }

  public updateVotes(votes: readonly ECPoint[]): void {
    this.mutableVotes = votes;
  }

  public toBuffer(): Buffer {
    const writer = new BinaryWriter();

    writer.writeArray(this.votes, writer.writeECPoint);

    return writer.toBuffer();
  }
}

export const NEO_METHODS: readonly ContractMethodData[] = [
  {
    name: 'unclaimedGas',
    price: FEES[3_000_000],
    returnType: ContractParameterType.Integer,
    parameters: [
      new ContractParameterDeclaration({ type: ContractParameterType.Hash160, name: 'account' }),
      new ContractParameterDeclaration({ type: ContractParameterType.Integer, name: 'end' }),
    ],
    safeMethod: true,
    delegate: (contract: NativeContractBase) => async ({ context, args }: OpInvokeArgs) => {
      const account = args[0].asUInt160();
      const end = args[1].asBigInteger();
      const storage = await context.blockchain.storageItem.tryGet(createAccountKey(contract.hash, account));
      if (storage === undefined) {
        return new IntegerStackItem(new BN(0));
      }

      const state = new NeoAccountState(storage);
      const bonus = calculateBonus(context, state.balance, state.height, end);

      return new IntegerStackItem(bonus);
    },
  },

  {
    name: 'registerValidator',
    price: FEES[5_000_000],
    returnType: ContractParameterType.Boolean,
    parameters: [new ContractParameterDeclaration({ type: ContractParameterType.PublicKey, name: 'pubkey' })],
    safeMethod: false,
    delegate: (contract: NativeContractBase) => async ({ context, args }: OpInvokeArgs) => {
      const pubkey = args[0].asECPoint();
      const key = createStorageKey(contract.hash, NeoToken.prefixValidator, pubkey);
      const storage = await context.blockchain.storageItem.tryGet(key);
      if (storage === undefined) {
        throw new InvalidValidatorStorage(context);
      }

      await context.blockchain.storageItem.add(
        new StorageItem({
          hash: key.hash,
          key: key.key,
          value: new ValidatorState({}).serializeWire(),
          flags: StorageFlags.None,
        }),
      );

      return new BooleanStackItem(true);
    },
  },

  {
    name: 'getRegisteredValidators',
    price: FEES[10_000_000],
    returnType: ContractParameterType.Array,
    parameters: [],
    safeMethod: true,
    delegate: (contract: NativeContractBase) => async ({ context }: OpInvokeArgs) => {
      const registeredValidators = await context.blockchain.storageItem
        .getAll$(createStorageKey(contract.hash, NeoToken.prefixValidator))
        .pipe(
          map(
            (validator) =>
              new StructStackItem([
                new ECPointStackItem(common.bufferToECPoint(validator.key)),
                new IntegerStackItem(
                  ValidatorState.deserializeWire({
                    context: context.blockchain.settings,
                    buffer: validator.value,
                  }).votes,
                ),
              ]),
          ),
          toArray(),
        )
        .toPromise();

      return new ArrayStackItem(registeredValidators);
    },
  },

  {
    name: 'getValidators',
    price: FEES[10_000_000],
    returnType: ContractParameterType.Array,
    parameters: [],
    safeMethod: true,
    delegate: (contract: NativeContractBase) => async ({ context }: OpInvokeArgs) => {
      const storage = await context.blockchain.storageItem.tryGet(
        createStorageKey(contract.hash, NeoToken.prefixNextValidators),
      );
      if (storage === undefined) {
        return new ArrayStackItem(
          context.blockchain.settings.standbyValidators.map((validator) => new ECPointStackItem(validator)),
        );
      }
      const validatorsCount = ValidatorsCount.deserializeWire({
        context: context.blockchain.settings,
        buffer: storage.value,
      });

      const numValidators = Math.max(
        utils.weightedAverage(
          utils
            .weightedFilter(
              validatorsCount.votes
                .map((votes, count) => ({ count, votes: votes === undefined ? utils.ZERO : votes }))
                .filter(({ votes }) => votes.gt(utils.ZERO)),
              0.25,
              0.75,
              ({ count }) => new BN(count),
            )
            .map(([{ count }, weight]) => ({ value: count, weight })),
        ),

        context.blockchain.settings.standbyValidators.length,
      );

      const standbyValidatorsSet = new Set(
        context.blockchain.settings.standbyValidators.map((publicKey) => common.ecPointToHex(publicKey)),
      );

      const validators = await context.blockchain.storageItem
        .getAll$(createStorageKey(contract.hash, NeoToken.prefixValidator))
        .pipe(
          map((validator) => ({
            publicKey: common.bufferToECPoint(validator.key),
            votes: ValidatorState.deserializeWire({
              context: context.blockchain.settings,
              buffer: validator.value,
            }).votes,
          })),
          toArray(),
        )
        .toPromise();

      const validatorsPublicKeySet = new Set(
        _.take(
          validators
            .filter(
              (validator) =>
                validator.votes.gt(utils.ZERO) || standbyValidatorsSet.has(common.ecPointToHex(validator.publicKey)),
            )
            .sort((aValidator, bValidator) =>
              aValidator.votes.eq(bValidator.votes)
                ? common.ecPointCompare(aValidator.publicKey, bValidator.publicKey)
                : -aValidator.votes.cmp(bValidator.votes),
            )
            .map((validator) => common.ecPointToHex(validator.publicKey)),
          numValidators,
        ),
      );

      const standbyValidatorsArray = [...standbyValidatorsSet];
      // tslint:disable-next-line no-loop-statement
      for (let i = 0; i < standbyValidatorsArray.length && validatorsPublicKeySet.size < numValidators; i += 1) {
        validatorsPublicKeySet.add(standbyValidatorsArray[i]);
      }

      const validatorsPublicKeys = [...validatorsPublicKeySet].map((hex) => common.hexToECPoint(hex));

      return new ArrayStackItem(
        // tslint:disable-next-line no-array-mutation
        validatorsPublicKeys
          .sort((aKey, bKey) => common.ecPointCompare(aKey, bKey))
          .map((pubKey) => new ECPointStackItem(pubKey)),
      );
    },
  },

  {
    name: 'getNextBlockValidators',
    price: FEES[10_000_000],
    returnType: ContractParameterType.Array,
    parameters: [],
    safeMethod: true,
    delegate: (contract: NativeContractBase) => async ({ context }: OpInvokeArgs) => {
      const storage = await context.blockchain.storageItem.tryGet(
        createStorageKey(contract.hash, NeoToken.prefixNextValidators),
      );
      if (storage === undefined) {
        return new ArrayStackItem(
          context.blockchain.settings.standbyValidators.map((validator) => new ECPointStackItem(validator)),
        );
      }

      return new ArrayStackItem(
        NeoAccountState.votesFromBuffer(storage.value).map((pubKey) => new ECPointStackItem(pubKey)),
      );
    },
  },

  {
    name: 'vote',
    price: FEES[50_000_000],
    returnType: ContractParameterType.Boolean,
    parameters: [
      new ContractParameterDeclaration({ type: ContractParameterType.Hash160, name: 'account' }),
      new ContractParameterDeclaration({ type: ContractParameterType.Array, name: 'pubkeys' }),
    ],
    safeMethod: false,
    delegate: (contract: NativeContractBase) => async ({ context, args }: OpInvokeArgs) => {
      const account = args[0].asUInt160();
      const pubKeysIn = args[1].asArray().map((item) => item.asECPoint());

      const witnessCheck = await checkWitness({ context, hash: account });
      if (!witnessCheck) {
        return new BooleanStackItem(false);
      }

      const accountKey = createAccountKey(contract.hash, account);
      const accountStorage = await context.blockchain.storageItem.tryGet(accountKey);
      if (accountStorage === undefined) {
        return new BooleanStackItem(false);
      }

      const accountState = new NeoAccountState(accountStorage);
      await Promise.all(
        accountState.votes.map(async (pubKey) => {
          const storageValidator = await context.blockchain.storageItem.get(
            createStorageKey(contract.hash, NeoToken.prefixValidator, common.ecPointToBuffer(pubKey)),
          );
          const validatorStateOld = ValidatorState.deserializeWire({
            context: context.blockchain.settings,
            buffer: storageValidator.value,
          });

          const validatorStateNew = validatorStateOld.update({
            votes: validatorStateOld.votes.sub(accountState.balance),
          });

          await context.blockchain.storageItem.update(storageValidator, {
            value: validatorStateNew.serializeWire(),
            flags: StorageFlags.None,
          });
        }),
      );

      const pubKeys = _.uniq(pubKeysIn).filter(async (pubKey) => {
        const val = await context.blockchain.storageItem.tryGet(
          createStorageKey(contract.hash, NeoToken.prefixValidator, common.ecPointToBuffer(pubKey)),
        );
        if (val === undefined) {
          return false;
        }

        return true;
      });

      if (pubKeys.length !== accountState.votes.length) {
        const key = createStorageKey(contract.hash, NeoToken.prefixValidatorCount);
        const validatorCountStorage = await context.blockchain.storageItem.tryGet(key);
        const validatorCountStateIn =
          validatorCountStorage === undefined
            ? new ValidatorsCount()
            : ValidatorsCount.deserializeWire({
                context: context.blockchain.settings,
                buffer: validatorCountStorage.value,
              });
        const votes = validatorCountStateIn.votes as BN[];
        if (accountState.votes.length > 0) {
          // tslint:disable-next-line no-array-mutation no-object-mutation
          votes[votes.length - 1] = votes[votes.length - 1].sub(accountState.balance);
        }
        if (pubKeys.length > 0) {
          // tslint:disable-next-line no-array-mutation no-object-mutation
          votes[pubKeys.length - 1] = votes[pubKeys.length - 1].add(accountState.balance);
        }
        const validatorCountState = validatorCountStateIn.update({ votes });

        if (validatorCountStorage === undefined) {
          await context.blockchain.storageItem.add(
            new StorageItem({
              key: key.key,
              hash: key.hash,
              value: validatorCountState.serializeWire(),
              flags: StorageFlags.None,
            }),
          );
        } else {
          await context.blockchain.storageItem.update(validatorCountStorage, {
            value: validatorCountState.serializeWire(),
            flags: StorageFlags.None,
          });
        }
      }

      accountState.updateVotes(pubKeys);
      await context.blockchain.storageItem.update(accountStorage, {
        value: accountState.toBuffer(),
        flags: StorageFlags.None,
      });

      await Promise.all(
        accountState.votes.map(async (pubKey) => {
          const validatorStorage = await context.blockchain.storageItem.get(
            createStorageKey(contract.hash, NeoToken.prefixValidator, common.ecPointToBuffer(pubKey)),
          );
          const validatorStateIn = ValidatorState.deserializeWire({
            context: context.blockchain.settings,
            buffer: validatorStorage.value,
          });
          const validatorState = validatorStateIn.update({ votes: validatorStateIn.votes.add(accountState.balance) });

          await context.blockchain.storageItem.update(validatorStorage, {
            value: validatorState.serializeWire(),
            flags: StorageFlags.None,
          });
        }),
      );

      return new BooleanStackItem(true);
    },
  },
];

const calculateBonus = (context: ExecutionContext, value: BN, start: BN, end: BN): BN => {
  if (value.isZero() || start.gte(end)) {
    return new BN(0);
  }
  if (value.isNeg()) {
    throw new ValueNegativeError(context, value);
  }

  // TODO: Finish
  return value;
};

export class NeoToken extends Nep5Token {
  public static readonly prefixValidator = Buffer.from([0x33]);
  public static readonly prefixValidatorCount = Buffer.from([0x15]);
  public static readonly prefixNextValidators = Buffer.from([0x14]);

  public constructor() {
    super({
      methods: NEO_METHODS,
      // TODO: Update this based on neo-project
      onBalanceChange: () => {
        // do nothing
      },
      serviceName: 'Neo.Native.Tokens.NEO',
      name: 'NEO',
      symbol: 'neo',
      decimals: new BN(0),
    });
  }

  public async initialize(context: ExecutionContext): Promise<boolean> {
    if (!this.initializeBase(context)) {
      return false;
    }
    const storageItem = await context.blockchain.storageItem.tryGet(
      createStorageKey(this.hash, Nep5Token.prefixTotalSupply),
    );
    if (storageItem === undefined) {
      return true;
    }

    // TODO: Fix this part
    const account = common.bufferToUInt160(Buffer.alloc(3, 20));

    await this.mint(context, account, new BN(30_000_000).mul(this.factor));

    // TODO: Register Validators
    return true;
  }

  public onPersist(_context: ExecutionContext) {
    // TODO: Finish
    return true;
  }
}
