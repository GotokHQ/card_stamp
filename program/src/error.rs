// inside error.rs
use thiserror::Error;
use solana_program::program_error::ProgramError;

#[derive(Error, Debug, Copy, Clone)]
pub enum CardError {
    /// Invalid instruction
    #[error("Invalid Owner")]
    InvalidOwner,
    #[error("Invalid Mint")]
    InvalidMint,
    #[error("Invalid Instruction")]
    InvalidInstruction,
    #[error("No rent excemption")]
    NotRentExempt,
    #[error("Amount mismatch")]
    ExpectedAmountMismatch,
    #[error("Authority is invalid")]
    InvalidAuthorityId,
    #[error("Amount overflow")]
    AmountOverflow,
    #[error("Account already settled")]
    AccountAlreadySettled,
    #[error("Account already canceled")]
    AccountAlreadyCanceled,
    #[error("Fee overflow")]
    FeeOverflow,
    #[error("Account not settled or canceled")]
    AccountNotSettledOrCanceled,
    #[error("Account not initialized")]
    AccountNotInitialized,
    #[error("Math overflow")]
    MathOverflow,
    #[error("Invalid deposit key")]
    InvalidDepositKey,
    #[error("Invalid withdraw key")]
    InvalidWithdrawKey,
    #[error("Invalid escrow key")]
    InvalidEscrowKey,
    #[error("Invalid vault owner")]
    InvalidVaultOwner,
    #[error("Invalid vault token owner")]
    InvalidVaultTokenOwner,
    #[error("Invalid source token owner")]
    InvalidSrcTokenOwner,
    #[error("Invalid destination token owner")]
    InvalidDstTokenOwner,
    #[error("Invalid fee token owner")]
    InvalidFeeTokenOwner,
    #[error("Invalid deposit token owner")]
    InvalidDepositTokenOwner,
    #[error("Invalid withdraw token owner")]
    InvalidWithdrawTokenOwner,
}

impl From<CardError> for ProgramError {
    fn from(e: CardError) -> Self {
        ProgramError::Custom(e as u32)
    }
}