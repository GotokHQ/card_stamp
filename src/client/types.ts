export interface InitCardInstructionParams {
  reference: string;
  memo: string;
  feePayer: string;
  wallet: string;
  mint: string;
  destinationWallet: string;
  amount: string;
  networkFee: string;
  platformFee?: string;
  referrerFee?: string;
  platform?: string;
  referrer?: string;
}
