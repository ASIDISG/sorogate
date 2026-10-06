//! Evaluation and validation. No storage access: everything here reads only its arguments, the
//! ledger time, and the balance functions of the tokens a policy names.
use soroban_sdk::{symbol_short, vec, Address, Env, Executable, IntoVal, TryFromVal, Val, Vec};

use crate::types::{Condition, DenyReason, Error, MAX_CONDITIONS};

/// True only for deployed contracts (WASM or a Stellar asset contract). Calling an account address as a
/// contract aborts the whole transaction instead of failing softly (measured on Testnet), so
/// addresses are checked when a policy is written.
fn is_contract(address: &Address) -> bool {
    matches!(
        address.executable(),
        Some(Executable::Wasm(_)) | Some(Executable::StellarAsset)
    )
}

pub(crate) fn validate(conditions: &Vec<Condition>) -> Result<(), Error> {
    let count = conditions.len();
    if count == 0 {
        return Err(Error::NoConditions);
    }
    if count > MAX_CONDITIONS {
        return Err(Error::TooManyConditions);
    }
    for condition in conditions.iter() {
        match condition {
            Condition::TokenBalance(c) => {
                if c.min <= 0 {
                    return Err(Error::InvalidMinimum);
                }
                if !is_contract(&c.token) {
                    return Err(Error::NotAContract);
                }
            }
            Condition::NftBalance(c) => {
                if c.min == 0 {
                    return Err(Error::InvalidMinimum);
                }
                if !is_contract(&c.collection) {
                    return Err(Error::NotAContract);
                }
            }
            Condition::TimeWindow(c) => match (c.not_before, c.not_after) {
                (None, None) => return Err(Error::InvalidTimeWindow),
                (Some(from), Some(to)) if from >= to => return Err(Error::InvalidTimeWindow),
                _ => {}
            },
        }
    }
    Ok(())
}

/// Calls `balance(who)` on `token`. `None` for any failure that can be caught: the contract raised an
/// error, panicked, has no such function, or returned a different type than `T`.
fn read_balance<T: TryFromVal<Env, Val>>(env: &Env, token: &Address, who: &Address) -> Option<T> {
    let args: Vec<Val> = vec![env, who.into_val(env)];
    match env.try_invoke_contract::<T, soroban_sdk::Error>(token, &symbol_short!("balance"), args) {
        Ok(Ok(balance)) => Some(balance),
        _ => None,
    }
}

fn check(env: &Env, condition: &Condition, subject: &Address, now: u64) -> Option<DenyReason> {
    match condition {
        Condition::TokenBalance(c) => match read_balance::<i128>(env, &c.token, subject) {
            Some(balance) if balance >= c.min => None,
            Some(_) => Some(DenyReason::BelowMinimum),
            None => Some(DenyReason::BalanceUnavailable),
        },
        Condition::NftBalance(c) => match read_balance::<u32>(env, &c.collection, subject) {
            Some(balance) if balance >= c.min => None,
            Some(_) => Some(DenyReason::BelowMinimum),
            None => Some(DenyReason::BalanceUnavailable),
        },
        Condition::TimeWindow(c) => {
            if matches!(c.not_before, Some(from) if now < from) {
                Some(DenyReason::BeforeWindow)
            } else if matches!(c.not_after, Some(to) if now >= to) {
                Some(DenyReason::AfterWindow)
            } else {
                None
            }
        }
    }
}

/// The first condition that does not hold, in order, with the reason. Stops at the first failure, so
/// conditions after it are never evaluated.
pub(crate) fn first_failure(
    env: &Env,
    conditions: &Vec<Condition>,
    subject: &Address,
    now: u64,
) -> Option<(u32, DenyReason)> {
    for (index, condition) in conditions.iter().enumerate() {
        if let Some(reason) = check(env, &condition, subject, now) {
            return Some((index as u32, reason));
        }
    }
    None
}
