export interface InitCardInstructionParams {
  reference: string;
  feePayer: string;
  wallet: string;
  sourceMint: string;
  destinationMint: string;
  destinationWallet: string;
  amount: string;
  networkFee: string;
  platformFee?: string;
  referrerFee?: string;
  refereeFeeDiscount?: string;
  platform?: string;
  referrer?: string;
}
