//! Instruction types
#![allow(missing_docs)]

use borsh::{BorshDeserialize, BorshSerialize};

/// Initialize a funding arguments
#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, PartialEq, Debug, Clone)]
/// Initialize a funding params
pub struct InitCardArgs {
    pub bump: u8,
    pub reference: String,
    pub memo: String,
    pub network_fee: u64,
    pub amount: u64,
    pub platform_fee: Option<u64>,
    pub referrer_fee: Option<u64>,
}


#[repr(C)]
#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq, Clone,)]
pub enum CardInstruction {
    Init(InitCardArgs),
}
