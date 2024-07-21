import {
  PublicKey,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { InitCardInstructionParams } from './types';
import { CardProgram } from '../card_program';
import { InitCardArgs } from '../transactions';
import BN from 'bn.js';

export const initCardInstruction = (input: InitCardInstructionParams) => {
  const feePayer = new PublicKey(input.feePayer);
  const wallet = new PublicKey(input.wallet);
  const [stamp, bump] = CardProgram.findStampAccount(input.reference);
  const sourceMint = new PublicKey(input.sourceMint);
  const destinationMint = new PublicKey(input.destinationMint);
  const inToken = spl.getAssociatedTokenAddressSync(sourceMint, wallet, true);
  const outToken = spl.getAssociatedTokenAddressSync(destinationMint, wallet, true);
  const payerToken = spl.getAssociatedTokenAddressSync(sourceMint, feePayer, true);
  let platformWallet: PublicKey | undefined;
  let platformToken: PublicKey | undefined;
  let platformFee: BN | undefined;
  let referrerWallet: PublicKey | undefined;
  let referrerToken: PublicKey | undefined;
  let referrerFee: BN | undefined;
  let refereeFee: BN | undefined;
  if (input.platformFee && input.platform) {
    platformWallet = new PublicKey(input.platform);
    platformToken = spl.getAssociatedTokenAddressSync(destinationMint, platformWallet, true);
    platformFee = new BN(input.platformFee);
  }
  if (input.referrerFee && input.referrer) {
    referrerWallet = new PublicKey(input.referrer);
    referrerToken = spl.getAssociatedTokenAddressSync(destinationMint, referrerWallet, true);
    referrerFee = new BN(input.referrer);
  }
  if (input.refereeFeeDiscount) {
    refereeFee = new BN(input.refereeFeeDiscount);
  }
  const destinationWallet = new PublicKey(input.destinationWallet);
  const destinationToken = spl.getAssociatedTokenAddressSync(
    destinationMint,
    destinationWallet,
    true,
  );
  const networkFee = new BN(input.networkFee);
  const amount = new BN(input.amount);
  const data = InitCardArgs.serialize({
    bump,
    reference: input.reference,
    networkFee,
    amount,
    referrerFee,
    platformFee,
    refereeFee,
  });
  const keys = [
    {
      pubkey: feePayer,
      isSigner: true,
      isWritable: true,
    },
    {
      pubkey: wallet,
      isSigner: true,
      isWritable: false,
    },
    {
      pubkey: stamp,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: sourceMint,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: destinationMint,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: payerToken,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: inToken,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: outToken,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: destinationWallet,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: destinationToken,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
  ];
  if (platformToken && platformWallet) {
    keys.push(
      {
        pubkey: platformWallet,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: platformToken,
        isSigner: false,
        isWritable: true,
      },
    );
  }
  if (referrerToken && referrerWallet) {
    keys.push(
      {
        pubkey: referrerWallet,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: referrerToken,
        isSigner: false,
        isWritable: true,
      },
    );
  }
  keys.push(
    {
      pubkey: spl.TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
  );
  return new TransactionInstruction({
    keys,
    data,
    programId: CardProgram.PUBKEY,
  });
};
