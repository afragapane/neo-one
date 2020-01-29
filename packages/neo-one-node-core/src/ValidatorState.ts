import { BinaryWriter, ECPoint, IOHelper, JSONHelper, ValidatorStateJSON } from '@neo-one/client-common';
import { BN } from 'bn.js';
import {
  createSerializeWire,
  DeserializeWireBaseOptions,
  DeserializeWireOptions,
  SerializableJSON,
  SerializableWire,
  SerializeJSONContext,
  SerializeWire,
} from './Serializable';
import { BinaryReader, utils } from './utils';

export interface ValidatorStateKey {
  readonly publicKey: ECPoint;
}

export interface ValidatorStateAdd {
  readonly votes?: BN;
}

export interface ValidatorStateUpdate {
  readonly votes?: BN;
}

export class ValidatorState implements SerializableWire<ValidatorState>, SerializableJSON<ValidatorStateJSON> {
  public static deserializeWireBase({ reader }: DeserializeWireBaseOptions): ValidatorState {
    const votes = reader.readFixed8();

    return new this({ votes });
  }

  public static deserializeWire(options: DeserializeWireOptions): ValidatorState {
    return this.deserializeWireBase({
      context: options.context,
      reader: new BinaryReader(options.buffer),
    });
  }

  public readonly votes: BN;
  public readonly serializeWire: SerializeWire = createSerializeWire(this.serializeWireBase.bind(this));
  private readonly sizeInternal: () => number;

  public constructor({ votes = utils.ZERO }: ValidatorStateAdd) {
    this.votes = votes;
    this.sizeInternal = utils.lazy(() => IOHelper.sizeOfFixed8);
  }

  public get size(): number {
    return this.sizeInternal();
  }

  public update({ votes = this.votes }: ValidatorStateUpdate): ValidatorState {
    return new ValidatorState({
      votes,
    });
  }

  public serializeWireBase(writer: BinaryWriter): void {
    writer.writeFixed8(this.votes);
  }

  public serializeJSON(_context: SerializeJSONContext): ValidatorStateJSON {
    return {
      votes: JSONHelper.writeFixed8(this.votes),
    };
  }
}
