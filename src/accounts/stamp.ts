import { Borsh, AnyPublicKey, ERROR_INVALID_OWNER, Account } from '@metaplex-foundation/mpl-core';
import { AccountInfo, PublicKey } from '@solana/web3.js';
import { CardProgram } from '../card_program';

export const MAX_STAMP_DATA_LEN = 1;

export type StampDataArgs = {
  isInitialized: boolean;
};

export class StampData extends Borsh.Data<StampDataArgs> {
  static readonly SCHEMA = StampData.struct([['isInitialized', 'u8']]);
  isInitialized: boolean;

  constructor(args: StampDataArgs) {
    super(args);
  }
}

export class Stamp extends Account<StampData> {
  static readonly PREFIX = 'stamp';
  constructor(pubkey: AnyPublicKey, info: AccountInfo<Buffer>) {
    super(pubkey, info);
    this.data = StampData.deserialize(this.info.data);
    if (!this.assertOwner(CardProgram.PUBKEY)) {
      throw ERROR_INVALID_OWNER();
    }
  }

  static async getPDA(reference: AnyPublicKey) {
    return CardProgram.findProgramAddress([
      Buffer.from(Stamp.PREFIX),
      new PublicKey(reference).toBuffer(),
    ]);
  }
}
