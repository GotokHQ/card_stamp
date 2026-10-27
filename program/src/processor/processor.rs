//! Init pass instruction processing

use crate::{
    instruction::InitCardArgs, state::{stamp::Stamp, FLAG_ACCOUNT_SIZE}, utils::*
};

use solana_program::{
    account_info::{next_account_info, AccountInfo}, entrypoint::ProgramResult, program_error::ProgramError, program_pack::{IsInitialized, Pack}, pubkey::Pubkey
};


use spl_token_2022::state::Mint;

/// Process InitPass instruction
pub fn init(program_id: &Pubkey, accounts: &[AccountInfo], args: InitCardArgs) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let payer_info = next_account_info(account_info_iter)?;
    let wallet_info = next_account_info(account_info_iter)?;
    let stamp_info = next_account_info(account_info_iter)?;
    let src_mint_info = next_account_info(account_info_iter)?;
    let dst_mint_info = next_account_info(account_info_iter)?;
    let payer_token_info = next_account_info(account_info_iter)?;
    let in_token_info = next_account_info(account_info_iter)?;
    let out_token_info = next_account_info(account_info_iter)?;
    let dst_wallet_info = next_account_info(account_info_iter)?;
    let dst_token_info = next_account_info(account_info_iter)?;
    let src_token_program_info = next_account_info(account_info_iter)?;
    let dst_token_program_info = next_account_info(account_info_iter)?;
    let rent_info = next_account_info(account_info_iter)?;
    let system_account_info = next_account_info(account_info_iter)?;

    assert_token_program(src_token_program_info)?;
    assert_token_program(dst_token_program_info)?;
    assert_owned_by(src_mint_info, src_token_program_info.key)?;
    assert_owned_by(dst_mint_info, dst_token_program_info.key)?;
    let src_mint: Mint = assert_initialized(src_mint_info)?;
    let dst_mint: Mint = assert_initialized(dst_mint_info)?;
    if let Some(platform_fee) = args.platform_fee {
        let platform_wallet_info = next_account_info(account_info_iter)?;
        let platform_token_info = next_account_info(account_info_iter)?;
        if cmp_pubkeys(&dst_mint_info.key, &spl_token::native_mint::id()) || cmp_pubkeys(&dst_mint_info.key, &spl_token_2022::native_mint::id()) {
            native_transfer(wallet_info, platform_wallet_info, platform_fee, &[])?;
        } else {
            if exists(platform_token_info)? {
                assert_token_account(platform_token_info, platform_wallet_info.key, dst_token_program_info.key)?;
            } else {
                create_associated_token_account_raw(
                    payer_info,
                    platform_token_info,
                    platform_wallet_info,
                    dst_mint_info,
                    rent_info,
                    &dst_token_program_info.key,
                )?;
            }
            spl_token_transfer(
                out_token_info,
                platform_token_info,
                wallet_info,
                dst_mint_info,
                dst_token_program_info.key,
                platform_fee,
                dst_mint.decimals,
                &[],
            )?;
        }
    }

    if let Some(referrer_fee) = args.referrer_fee {
        let referrer_wallet_info = next_account_info(account_info_iter)?;
        let referrer_token_info = next_account_info(account_info_iter)?;
        if cmp_pubkeys(&dst_mint_info.key, &spl_token::native_mint::id()) || cmp_pubkeys(&dst_mint_info.key, &spl_token_2022::native_mint::id()) {
            native_transfer(wallet_info, referrer_wallet_info, referrer_fee, &[])?;
        } else {
            if exists(referrer_token_info)? {
                assert_token_account(referrer_token_info, referrer_wallet_info.key, dst_token_program_info.key)?;
            } else {
                create_associated_token_account_raw(
                    payer_info,
                    referrer_token_info,
                    referrer_wallet_info,
                    dst_mint_info,
                    rent_info,
                    &dst_token_program_info.key,
                )?;
            }
            spl_token_transfer(
                out_token_info,
                referrer_token_info,
                wallet_info,
                dst_mint_info,
                dst_token_program_info.key,
                referrer_fee,
                dst_mint.decimals,
                &[],
            )?;
        }
    }

    if cmp_pubkeys(&dst_mint_info.key, &spl_token::native_mint::id()) || cmp_pubkeys(&dst_mint_info.key, &spl_token_2022::native_mint::id()) {
        native_transfer(wallet_info, dst_wallet_info, args.amount, &[])?;
    } else {
        if exists(dst_token_info)? {
            assert_token_account(dst_token_info, dst_wallet_info.key, dst_token_program_info.key)?;
        } else {
            create_associated_token_account_raw(
                payer_info,
                dst_token_info,
                dst_wallet_info,
                dst_mint_info,
                rent_info,
                &dst_token_program_info.key,
            )?;
        }
        spl_token_transfer(
            out_token_info,
            dst_token_info,
            wallet_info,
            dst_mint_info,
            dst_token_program_info.key,
            args.amount,
            dst_mint.decimals,
            &[],
        )?;
    }

    if cmp_pubkeys(&src_mint_info.key, &spl_token::native_mint::id())  || cmp_pubkeys(&src_mint_info.key, &spl_token_2022::native_mint::id()){
        native_transfer(wallet_info, payer_info, args.network_fee, &[])?;
    } else {
        if exists(payer_token_info)? {
            assert_token_account(payer_token_info, payer_info.key, src_token_program_info.key)?;
        } else {
            create_associated_token_account_raw(
                payer_info,
                payer_token_info,
                payer_info,
                src_mint_info,
                rent_info,
                &src_token_program_info.key,
            )?;
        }
        spl_token_transfer(
            in_token_info,
            payer_token_info,
            wallet_info,
            src_mint_info,
            src_token_program_info.key,
            args.network_fee,
            src_mint.decimals,
            &[],
        )?;
    }
    if stamp_info.lamports() > 0 && !stamp_info.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    create_new_account_raw(
        program_id,
        stamp_info,
        rent_info,
        payer_info,
        system_account_info,
        FLAG_ACCOUNT_SIZE,
        &[
            Stamp::PREFIX.as_bytes(),
            &bs58::decode(args.reference)
            .into_vec()
            .map_err(|_| ProgramError::InvalidArgument)?,
            &[args.bump],
        ],
    )?;
    let mut stamp = Stamp::unpack_unchecked(&stamp_info.data.borrow())?;
    if stamp.is_initialized() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    stamp.is_initialized = true;
    Stamp::pack(stamp, *stamp_info.data.borrow_mut())?;
    Ok(())
}
