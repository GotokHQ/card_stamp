export interface InitCardInstructionParams {
  reference: string;
  feePayer: string;
  wallet: string;
  sourceMint: string;
  sourceTokenProgramId: string;
  destinationMint: string;
  destinationWallet: string;
  destinationTokenProgramId: string;
  amount: string;
  networkFee: string;
  platformFee?: string;
  referrerFee?: string;
  refereeFeeDiscount?: string;
  platform?: string;
  referrer?: string;
}

export interface CloseStampInstructionParams {
  /** The authority signer pubkey (must sign the transaction) */
  authority: string;
  /** The base58-encoded reference used when the stamp was created (to derive the PDA) */
  reference: string;
  /**
   * The destination wallet pubkey to receive reclaimed rent lamports.
   *
   * Convention: This should always be the FEE_PAYER wallet (the same wallet
   * that originally paid the rent when creating the stamp via InitCard).
   * The on-chain program accepts any destination, but the backend enforces
   * that rent is returned to the fee payer.
   */
  destination: string;
}
