import {
  BinaryWriter,
  createSerializeWire,
  IOHelper,
  SerializableWire,
  SerializeWire,
  utils,
} from '@neo-one/client-common';
import { BN } from 'bn.js';
import { DeserializeWireBaseOptions, DeserializeWireOptions } from './Serializable';
import { BinaryReader } from './utils';

type Votes = ReadonlyArray<BN | undefined>;
export interface ValidatorsCountUpdate {
  readonly votes?: Votes;
}

export interface ValidatorsCountAdd {
  readonly votes?: Votes;
}

export class ValidatorsCount implements SerializableWire<ValidatorsCount> {
  public static deserializeWireBase(options: DeserializeWireBaseOptions): ValidatorsCount {
    const { reader } = options;
    const votes = reader.readArray(() => reader.readFixed8());

    return new this({ votes });
  }

  public static deserializeWire(options: DeserializeWireOptions): ValidatorsCount {
    return this.deserializeWireBase({
      context: options.context,
      reader: new BinaryReader(options.buffer),
    });
  }

  public readonly serializeWire: SerializeWire = createSerializeWire(this.serializeWireBase.bind(this));
  public readonly votes: Votes;
  private readonly sizeInternal: () => number;

  public constructor({ votes = [] }: ValidatorsCountAdd = {}) {
    this.votes = votes;
    this.sizeInternal = utils.lazy(
      () => IOHelper.sizeOfUInt8 + IOHelper.sizeOfArray(this.votes, () => IOHelper.sizeOfFixed8),
    );
  }

  public get size(): number {
    return this.sizeInternal();
  }

  public update({ votes = this.votes }: ValidatorsCountUpdate): ValidatorsCount {
    return new ValidatorsCount({
      votes,
    });
  }

  public serializeWireBase(writer: BinaryWriter): void {
    writer.writeArray(this.votes, (value) => {
      writer.writeFixed8(value === undefined ? utils.ZERO : value);
    });
  }
}
