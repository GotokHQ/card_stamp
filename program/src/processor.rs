use borsh::BorshDeserialize;
use crate::instruction::CardInstruction;

use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey};

pub mod processor;

pub struct Processor;
impl Processor {
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        let instruction = CardInstruction::try_from_slice(instruction_data)?;
        msg!("Successfully deserialized init pre swap instruction");

        match instruction {
            CardInstruction::Init(args) => {
                msg!("Instruction: Init Stamp");
                processor::init(program_id, accounts, args)
            }
        }
    }
}
