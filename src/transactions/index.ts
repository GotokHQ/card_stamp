import { Borsh } from '@metaplex-foundation/mpl-core';
import BN from 'bn.js';

export type CardInitArgs = {
  bump: number;
  reference: string;
  memo: string;
  networkFee: BN;
  amount: BN;
  platformFee?: BN;
  referrerFee?: BN;
  refereeFee?: BN;
};

export class InitCardArgs extends Borsh.Data<CardInitArgs> {
  static readonly SCHEMA = InitCardArgs.struct([
    ['instruction', 'u8'],
    ['bump', 'u8'],
    ['reference', 'string'],
    ['memo', 'string'],
    ['networkFee', 'u64'],
    ['amount', 'u64'],
    ['platformFee', { kind: 'option', type: 'u64' }],
    ['referrerFee', { kind: 'option', type: 'u64' }],
    ['refereeFee', { kind: 'option', type: 'u64' }],
  ]);

  instruction = 0;
  bump: number;
  reference: string;
  memo: string;
  networkFee: BN;
  amount: BN;
  platformFee?: BN;
  referrerFee?: BN;
  refereeFee?: BN;
}
