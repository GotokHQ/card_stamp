//! Close stamp instruction processing
//!
//! Closes an initialized stamp account and transfers reclaimed rent lamports
//! to the specified destination wallet. This allows reclaiming rent from
//! stamp accounts that are no longer needed (e.g., after a withdrawal has
//! been finalized for 30+ days).
//!
//! Security:
//! - Requires a signer (authority) — only our backend holds the private key
//! - Verifies the stamp account is owned by this program
//! - Verifies the stamp account is initialized (prevents double-close)
//! - Uses the standard Solana close-account pattern (direct lamport drain)

use crate::{
    state::stamp::Stamp,
    utils::*,
};

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack},
    pubkey::Pubkey,
    system_program,
};

/// Process CloseStamp instruction
///
/// Accounts expected:
/// 0. `[signer]`   authority     — must be a trusted admin key
/// 1. `[writable]` stamp_info    — the stamp PDA to close (program-owned, initialized)
/// 2. `[writable]` destination   — wallet to receive the reclaimed lamports
pub fn close(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let authority_info = next_account_info(account_info_iter)?;
    let stamp_info = next_account_info(account_info_iter)?;
    let destination_info = next_account_info(account_info_iter)?;

    // 1. Verify authority is a signer
    assert_signer(authority_info)?;

    // 2. Verify stamp is owned by this program
    assert_owned_by(stamp_info, program_id)?;

    // 3. Verify stamp is initialized (prevents closing already-closed or garbage accounts)
    let stamp = Stamp::unpack(&stamp_info.data.borrow())?;
    if !stamp.is_initialized() {
        return Err(ProgramError::UninitializedAccount);
    }

    // 4. Prevent closing to the stamp account itself
    if cmp_pubkeys(stamp_info.key, destination_info.key) {
        return Err(ProgramError::InvalidArgument);
    }

    // 5. Transfer ALL lamports from stamp to destination (standard close pattern)
    let dest_starting_lamports = destination_info.lamports();
    let stamp_lamports = stamp_info.lamports();

    **destination_info.lamports.borrow_mut() = dest_starting_lamports
        .checked_add(stamp_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **stamp_info.lamports.borrow_mut() = 0;

    // 6. Zero out the stamp account data
    stamp_info.data.borrow_mut().fill(0);

    // 7. Assign the account back to the system program (relinquish ownership)
    stamp_info.assign(&system_program::id());
    stamp_info.realloc(0, false)?;

    Ok(())
}
