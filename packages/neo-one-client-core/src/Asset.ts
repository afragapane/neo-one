import BN from 'bn.js';
import { CustomError } from '@neo-one/utils';
import {
  AssetType,
  AssetTypeJSON,
  assertAssetType,
  toJSONAssetType,
} from './AssetType';
import { BaseState } from './BaseState';
import { Equatable, Equals } from './Equatable';
import {
  DeserializeWireBaseOptions,
  DeserializeWireOptions,
  SerializeWire,
  SerializableWire,
  SerializeJSONContext,
  SerializableJSON,
  createSerializeWire,
} from './Serializable';
import { common, ECPoint, UInt160, UInt256, UInt256Hex } from './common';
import { crypto } from './crypto';
import {
  utils,
  BinaryReader,
  BinaryWriter,
  IOHelper,
  JSONHelper,
} from './utils';

export class InvalidAssetError extends CustomError {
  public readonly code: string;

  constructor(message: string) {
    super(message);
    this.code = 'INVALID_ASSET';
  }
}

export interface AssetKey {
  hash: UInt256;
}
export interface AssetAdd {
  version?: number;
  hash: UInt256;
  type: AssetType;
  name: string;
  amount: BN;
  available?: BN;
  precision: number;
  feeMode?: number;
  fee?: BN;
  feeAddress?: UInt160;
  owner: ECPoint;
  admin: UInt160;
  issuer: UInt160;
  expiration: number;
  isFrozen?: boolean;
}

export interface AssetUpdate {
  available?: BN;
  expiration?: number;
  isFrozen?: boolean;
}

export type AssetNameJSON = string | Array<{ lang: string; name: string }>;

export interface AssetJSON {
  version: number;
  id: string;
  type: AssetTypeJSON;
  name: AssetNameJSON;
  amount: string;
  available: string;
  precision: number;
  owner: string;
  admin: string;
  issuer: string;
  expiration: number;
  frozen: boolean;
}
export class Asset extends BaseState
  implements SerializableWire<Asset>, SerializableJSON<AssetJSON>, Equatable {
  public readonly hash: UInt256;
  public readonly hashHex: UInt256Hex;
  public readonly type: AssetType;
  public readonly name: string;
  public readonly amount: BN;
  public readonly available: BN;
  public readonly precision: number;
  public readonly feeMode: number;
  public readonly fee: BN;
  public readonly feeAddress: UInt160;
  public readonly owner: ECPoint;
  public readonly admin: UInt160;
  public readonly issuer: UInt160;
  public readonly expiration: number;
  public readonly isFrozen: boolean;
  public readonly equals: Equals = utils.equals(Asset, (other) =>
    common.uInt256Equal(this.hash, other.hash),
  );
  public readonly serializeWire: SerializeWire = createSerializeWire(
    this.serializeWireBase.bind(this),
  );
  private readonly sizeInternal: () => number;

  constructor({
    version,
    hash,
    type,
    name,
    amount,
    available,
    precision,
    feeMode,
    fee,
    feeAddress,
    owner,
    admin,
    issuer,
    expiration,
    isFrozen,
  }: AssetAdd) {
    super({ version });
    // eslint-disable-next-line
    verifyAsset({ name, type, amount, precision });
    this.hash = hash;
    this.hashHex = common.uInt256ToHex(hash);
    this.type = type;
    this.name = name;
    this.amount = amount;
    this.available = available || utils.ZERO;
    this.precision = precision;
    this.feeMode = feeMode || 0;
    this.fee = fee || utils.ZERO;
    this.feeAddress = feeAddress || common.ZERO_UINT160;
    this.owner = owner;
    this.admin = admin;
    this.issuer = issuer;
    this.expiration = expiration;
    this.isFrozen = isFrozen || false;
    this.sizeInternal = utils.lazy(
      () =>
        IOHelper.sizeOfUInt8 +
        IOHelper.sizeOfUInt256 +
        IOHelper.sizeOfUInt8 +
        IOHelper.sizeOfVarString(this.name) +
        IOHelper.sizeOfFixed8 +
        IOHelper.sizeOfFixed8 +
        IOHelper.sizeOfUInt8 +
        IOHelper.sizeOfUInt8 +
        IOHelper.sizeOfFixed8 +
        IOHelper.sizeOfUInt160 +
        IOHelper.sizeOfECPoint(this.owner) +
        IOHelper.sizeOfUInt160 +
        IOHelper.sizeOfUInt160 +
        IOHelper.sizeOfUInt32LE +
        IOHelper.sizeOfBoolean,
    );
  }
  public get size(): number {
    return this.sizeInternal();
  }

  public update({ available, expiration, isFrozen }: AssetUpdate): Asset {
    return new Asset({
      hash: this.hash,
      type: this.type,
      name: this.name,
      amount: this.amount,
      precision: this.precision,
      fee: this.fee,
      feeAddress: this.feeAddress,
      owner: this.owner,
      admin: this.admin,
      issuer: this.issuer,
      available: available == null ? this.available : available,
      expiration: expiration == null ? this.expiration : expiration,
      isFrozen: isFrozen == null ? this.isFrozen : isFrozen,
    });
  }
  public serializeWireBase(writer: BinaryWriter): void {
    writer.writeUInt8(this.version);
    writer.writeUInt256(this.hash);
    writer.writeUInt8(this.type);
    writer.writeVarString(this.name);
    writer.writeFixed8(this.amount);
    writer.writeFixed8(this.available);
    writer.writeUInt8(this.precision);
    writer.writeUInt8(this.feeMode);
    writer.writeFixed8(this.fee);
    writer.writeUInt160(this.feeAddress);
    writer.writeECPoint(this.owner);
    writer.writeUInt160(this.admin);
    writer.writeUInt160(this.issuer);
    writer.writeUInt32LE(this.expiration);
    writer.writeBoolean(this.isFrozen);
  }

  public deserializeWireBase({ reader }: DeserializeWireBaseOptions): Asset {
    const version = reader.readUInt8();
    const hash = reader.readUInt256();
    const type = assertAssetType(reader.readUInt8());
    const name = reader.readVarString();
    const amount = reader.readFixed8();
    const available = reader.readFixed8();
    const precision = reader.readUInt8();
    reader.readUInt8(); // FeeMode
    const fee = reader.readFixed8();
    const feeAddress = reader.readUInt160();
    const owner = reader.readECPoint();
    const admin = reader.readUInt160();
    const issuer = reader.readUInt160();
    const expiration = reader.readUInt32LE();
    const isFrozen = reader.readBoolean();

    return new Asset({
      version,
      hash,
      type,
      name,
      amount,
      available,
      precision,
      fee,
      feeAddress,
      owner,
      admin,
      issuer,
      expiration,
      isFrozen,
    });
  }
  public deserializeWire(options: DeserializeWireOptions): Asset {
    return this.deserializeWireBase({
      context: options.context,
      reader: new BinaryReader(options.buffer),
    });
  }
  public serializeJSON(context: SerializeJSONContext): AssetJSON {
    let name = this.name || '';
    try {
      name = JSON.parse(name);
    } catch (error) {
      // ignore errors
    }

    return {
      version: this.version,
      id: JSONHelper.writeUInt256(this.hash),
      type: toJSONAssetType(this.type),
      name,
      amount: JSONHelper.writeFixed8(this.amount),
      available: JSONHelper.writeFixed8(this.available),
      precision: this.precision,
      owner: JSONHelper.writeECPoint(this.owner),
      admin: crypto.scriptHashToAddress({
        addressVersion: context.addressVersion,
        scriptHash: this.admin,
      }),

      issuer: crypto.scriptHashToAddress({
        addressVersion: context.addressVersion,
        scriptHash: this.issuer,
      }),

      expiration: this.expiration,
      frozen: this.isFrozen,
    };
  }
}

export const verifyAsset = ({
  name,
  type,
  amount,
  precision,
}: {
  name: AssetAdd['name'];
  type: AssetAdd['type'];
  amount: AssetAdd['amount'];
  precision: AssetAdd['precision'];
}) => {
  if (type === AssetType.CreditFlag || type === AssetType.DutyFlag) {
    throw new InvalidAssetError(
      'Asset type cannot be CREDIT_FLAG or DUTY_FLAG',
    );
  }

  const nameBuffer = Buffer.from(name, 'utf8');
  if (nameBuffer.length > 1024) {
    throw new InvalidAssetError('Name too long');
  }

  if (amount.lte(utils.ZERO) && !amount.eq(common.NEGATIVE_SATOSHI_FIXED8)) {
    throw new InvalidAssetError('Amount must be greater than 0');
  }

  if (
    type === AssetType.Invoice &&
    !amount.eq(common.NEGATIVE_SATOSHI_FIXED8)
  ) {
    throw new InvalidAssetError('Invoice assets must have unlimited amount.');
  }

  if (precision > 8) {
    throw new InvalidAssetError('Max precision is 8.');
  }

  if (
    !amount.eq(utils.NEGATIVE_SATOSHI) &&
    !amount.mod(utils.TEN.pow(utils.EIGHT.subn(precision))).eq(utils.ZERO)
  ) {
    throw new InvalidAssetError('Invalid precision for amount.');
  }
};