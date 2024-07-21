//! Program utils

//! Program utils

use std::convert::TryInto;

use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, msg, program::{invoke, invoke_signed}, program_error::ProgramError, program_memory::sol_memcmp, program_pack::{IsInitialized, Pack}, pubkey::{Pubkey, PUBKEY_BYTES}, system_instruction, sysvar::{rent::Rent, Sysvar}
};

use spl_associated_token_account::instruction::create_associated_token_account;
use spl_token::state::Account;

/// Assert uninitialized
pub fn assert_uninitialized<T: IsInitialized>(account: &T) -> ProgramResult {
    if account.is_initialized() {
        Err(ProgramError::AccountAlreadyInitialized)
    } else {
        Ok(())
    }
}

/// Assert signer
pub fn assert_signer(account: &AccountInfo) -> ProgramResult {
    if account.is_signer {
        return Ok(());
    }

    Err(ProgramError::MissingRequiredSignature)
}


pub fn create_new_account_raw<'a>(
    program_id: &Pubkey,
    new_account_info: &AccountInfo<'a>,
    rent_sysvar_info: &AccountInfo<'a>,
    payer_info: &AccountInfo<'a>,
    system_program_info: &AccountInfo<'a>,
    size: usize,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let rent = &Rent::from_account_info(rent_sysvar_info)?;
    let required_lamports = rent.minimum_balance(size);

    if required_lamports > 0 {
        msg!("Transfer {} lamports to the new account", required_lamports);
        invoke(
            &system_instruction::transfer(&payer_info.key, new_account_info.key, required_lamports),
            &[
                payer_info.clone(),
                new_account_info.clone(),
                system_program_info.clone(),
            ],
        )?;
    }

    let accounts = &[new_account_info.clone(), system_program_info.clone()];

    msg!("Allocate space for the account {}", new_account_info.key);
    invoke_signed(
        &system_instruction::allocate(new_account_info.key, size.try_into().unwrap()),
        accounts,
        &[&signer_seeds],
    )?;

    msg!("Assign the account to the owning program");
    invoke_signed(
        &system_instruction::assign(new_account_info.key, program_id),
        accounts,
        &[&signer_seeds],
    )?;
    Ok(())
}

pub fn create_associated_token_account_raw<'a>(
    payer_info: &AccountInfo<'a>,
    vault_token_info: &AccountInfo<'a>,
    wallet_info: &AccountInfo<'a>,
    mint_info: &AccountInfo<'a>,
    rent_sysvar_info: &AccountInfo<'a>,
) -> ProgramResult {
    invoke(
        &create_associated_token_account(payer_info.key, wallet_info.key, mint_info.key, &spl_token::id()),
        &[
            payer_info.clone(),
            vault_token_info.clone(),
            wallet_info.clone(),
            mint_info.clone(),
            rent_sysvar_info.clone(),
        ],
    )
}


pub fn exists(account: &AccountInfo) -> Result<bool, ProgramError> {
    Ok(account.try_lamports()? > 0)
}

/// Checks two pubkeys for equality in a computationally cheap way using
/// `sol_memcmp`
pub fn cmp_pubkeys(a: &Pubkey, b: &Pubkey) -> bool {
    sol_memcmp(a.as_ref(), b.as_ref(), PUBKEY_BYTES) == 0
}

/// assert initialized account
pub fn assert_initialized<T: Pack + IsInitialized>(
    account_info: &AccountInfo,
) -> Result<T, ProgramError> {
    let account: T = T::unpack_unchecked(&account_info.data.borrow())?;
    if !account.is_initialized() {
        Err(ProgramError::UninitializedAccount)
    } else {
        Ok(account)
    }
}

/// Assert owned by
pub fn assert_token_owned_by(token: &Account, owner: &Pubkey) -> ProgramResult {
    if !cmp_pubkeys(&token.owner, owner) {
        Err(ProgramError::IllegalOwner)
    } else {
        Ok(())
    }
}


/// Assert owned by
pub fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if !cmp_pubkeys(&account.owner, owner)  {
        Err(ProgramError::IllegalOwner)
    } else {
        Ok(())
    }
}
/// SPL transfer instruction.
pub fn spl_token_transfer<'a>(
    source: &AccountInfo<'a>,
    destination: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    amount: u64,
    signers_seeds: &[&[&[u8]]],
) -> Result<(), ProgramError> {
    let ix = spl_token::instruction::transfer(
        &spl_token::id(),
        source.key,
        destination.key,
        authority.key,
        &[],
        amount,
    )?;

    invoke_signed(
        &ix,
        &[source.clone(), destination.clone(), authority.clone()],
        signers_seeds,
    )
}

/// Native instruction.
pub fn native_transfer<'a>(
    source: &AccountInfo<'a>,
    destination: &AccountInfo<'a>,
    amount: u64,
    signers_seeds: &[&[&[u8]]],
) -> Result<(), ProgramError> {
    invoke_signed(
        // for native SOL transfer user_wallet key == user_token_account key
        &system_instruction::transfer(&source.key, &destination.key, amount),
        &[source.clone(), destination.clone()],
        signers_seeds,
    )
}
