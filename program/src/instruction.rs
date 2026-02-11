//! Instruction types
#![allow(missing_docs)]

use borsh::{BorshDeserialize, BorshSerialize};

/// Initialize a card stamp with token transfers
#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
pub struct InitCardArgs {
    pub bump: u8,
    pub reference: String,
    pub network_fee: u64,
    pub amount: u64,
    pub platform_fee: Option<u64>,
    pub referrer_fee: Option<u64>,
    pub referee_fee: Option<u64>,
}


#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Clone,)]
pub enum CardInstruction {
    /// Initialize a stamp account with token transfers.
    ///
    /// Accounts expected:
    /// 0. `[signer, writable]` The fee payer
    /// 1. `[signer]`           The wallet (source of funds)
    /// 2. `[writable]`         The stamp account (PDA)
    /// 3. `[]`                 Source mint
    /// 4. `[]`                 Destination mint
    /// 5. `[writable]`         Payer token account
    /// 6. `[writable]`         In token account (wallet's source token)
    /// 7. `[writable]`         Out token account (wallet's dest token)
    /// 8. `[]`                 Destination wallet
    /// 9. `[writable]`         Destination token account
    /// 10. `[]`                Source token program
    /// 11. `[]`                Destination token program
    /// 12. `[]`                Rent sysvar
    /// 13. `[]`                System program
    /// (optional) 14-15: platform wallet + token
    /// (optional) 16-17: referrer wallet + token
    /// (last) Associated token program
    Init(InitCardArgs),

    /// Close a stamp account and reclaim rent lamports.
    ///
    /// Accounts expected:
    /// 0. `[signer]`   The authority (must be a trusted admin key)
    /// 1. `[writable]` The stamp account (PDA) to close — must be owned by this program and initialized
    /// 2. `[writable]` The destination wallet to receive reclaimed lamports
    CloseStamp,
}
