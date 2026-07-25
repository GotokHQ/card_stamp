//! Close stamp instruction processing
//!
//! Closes an initialized stamp account and transfers reclaimed rent lamports
//! to the specified destination wallet. This allows reclaiming rent from
//! stamp accounts that are no longer needed (e.g., after a withdrawal has
//! been finalized for 30+ days).
//!
//! Security:
//! - Requires the signer to be one of the trusted platform authorities
//!   ([`CLOSE_AUTHORITIES`]) — NOT merely *any* signer
//! - Verifies the stamp account is owned by this program
//! - Verifies the stamp account is initialized (prevents double-close)
//! - Uses the standard Solana close-account pattern (direct lamport drain)

use crate::{
    error::CardError,
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

/// Platform keys permitted to close stamp PDAs and reclaim their rent.
///
/// A stamp PDA custodies no SPL tokens — only the SOL paid to make it
/// rent-exempt at init. `assert_signer` proves the transaction carried *a*
/// signature, but not *whose*. Without an identity check, any wallet could
/// sign a `CloseStamp`, close an arbitrary stamp PDA, and redirect the
/// reclaimed rent to itself (observed on mainnet: an external bot closing
/// our stamps within hours of creation). Gating the authority to these
/// platform-controlled keys keeps rent recovery with us.
///
/// Contains the platform admin authority key (AUTHORITY_PUB_KEY) for every
/// environment the program is deployed to. The backend reclaim job signs
/// closes with this key (see stamp_reclaim.ts); the hot fee-payer wallet is
/// deliberately NOT trusted to close. To rotate or add a signer, append its
/// key here and redeploy.
const CLOSE_AUTHORITIES: [Pubkey; 3] = [
    solana_program::pubkey!("EZAz1JFj672FY9Wu1oo6FZMWoB5Sf62qCukzKr6qTRke"), // prod authority
    solana_program::pubkey!("EKDgQNzdN8RtBm52vi6dWRH2zGCYCmt1cyt8rD6MVqfK"), // staging authority (staging runs on mainnet)
    solana_program::pubkey!("5LQWmGCrAZ6qoaaJzTtVAbiV9MiQBoHp9z2HvjZgXsE4"), // dev authority (devnet)
];

/// Test-only close authority so bankrun tests can exercise the happy path.
/// Derived from the publicly-known seed `[7u8; 32]` — it holds nothing and
/// authorizes nothing outside tests, because it is compiled in ONLY with
/// `--features test-bpf`. Never deploy a binary built with that feature.
#[cfg(feature = "test-bpf")]
const TEST_CLOSE_AUTHORITY: Pubkey =
    solana_program::pubkey!("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");

/// Whether `key` is permitted to close stamps and receive reclaimed rent.
fn is_authorized_closer(key: &Pubkey) -> bool {
    if CLOSE_AUTHORITIES
        .iter()
        .any(|authorized| cmp_pubkeys(key, authorized))
    {
        return true;
    }
    #[cfg(feature = "test-bpf")]
    if cmp_pubkeys(key, &TEST_CLOSE_AUTHORITY) {
        return true;
    }
    false
}

/// Process CloseStamp instruction
///
/// Accounts expected:
/// 0. `[signer]`   authority     — must be one of [`CLOSE_AUTHORITIES`]
/// 1. `[writable]` stamp_info    — the stamp PDA to close (program-owned, initialized)
/// 2. `[writable]` destination   — wallet to receive the reclaimed lamports
pub fn close(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let authority_info = next_account_info(account_info_iter)?;
    let stamp_info = next_account_info(account_info_iter)?;
    let destination_info = next_account_info(account_info_iter)?;

    // 1. Verify authority is a signer
    assert_signer(authority_info)?;

    // 2. Verify the signer is a trusted platform authority. `assert_signer`
    //    alone lets ANY wallet close ANY stamp and pocket the rent; this pins
    //    close rights to our own keys.
    if !is_authorized_closer(authority_info.key) {
        return Err(CardError::InvalidAuthorityId.into());
    }

    // 3. Verify stamp is owned by this program
    assert_owned_by(stamp_info, program_id)?;

    // 4. Verify stamp is initialized (prevents closing already-closed or garbage accounts)
    let stamp = Stamp::unpack(&stamp_info.data.borrow())?;
    if !stamp.is_initialized() {
        return Err(ProgramError::UninitializedAccount);
    }

    // 5. Prevent closing to the stamp account itself
    if cmp_pubkeys(stamp_info.key, destination_info.key) {
        return Err(ProgramError::InvalidArgument);
    }

    // 6. Transfer ALL lamports from stamp to destination (standard close pattern)
    let dest_starting_lamports = destination_info.lamports();
    let stamp_lamports = stamp_info.lamports();

    **destination_info.lamports.borrow_mut() = dest_starting_lamports
        .checked_add(stamp_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **stamp_info.lamports.borrow_mut() = 0;

    // 7. Zero out the stamp account data
    stamp_info.data.borrow_mut().fill(0);

    // 8. Assign the account back to the system program (relinquish ownership)
    stamp_info.assign(&system_program::id());
    stamp_info.realloc(0, false)?;

    Ok(())
}
