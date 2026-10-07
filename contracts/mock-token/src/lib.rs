#![no_std]
//! **Test fixture only. Do not use for anything real.**
//!
//! A fake "token" with one function that matters, `balance(Address)`, whose behaviour is chosen when it is
//! deployed. It lets tests, on a local environment and on Testnet, exercise every way a token can answer an access
//! policy: a SEP-41 shaped `i128`, a SEP-50 shaped `u32`, a different integer width, and an error.
//!
//! There is no access control: **anyone can set any balance**. That is the point of a fixture, and the reason this
//! crate must never be deployed anywhere that matters.
use soroban_sdk::{contract, contractimpl, contractmeta, symbol_short, Address, Env, IntoVal, Val};

#[cfg(test)]
mod test;

contractmeta!(
    key = "Description",
    val = "Sorogate TEST FIXTURE. Not a real token: anyone can set any balance."
);

/// What `balance` does.
pub const MODE_I128: u32 = 0; // returns an i128 (the SEP-41 shape)
pub const MODE_U32: u32 = 1; // returns a u32 (the SEP-50 shape OpenZeppelin implements)
pub const MODE_U64: u32 = 2; // returns a u64: an unsigned integer, but not a u32
pub const MODE_PANICS: u32 = 3; // raises an error

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    /// Chooses what `balance` does, once. `mode` is one of the `MODE_*` constants.
    pub fn __constructor(env: Env, mode: u32) {
        assert!(mode <= MODE_PANICS, "unknown mode");
        env.storage().instance().set(&symbol_short!("mode"), &mode);
    }

    /// Sets the balance `balance` reports for `who`. In `MODE_U32` the amount must fit a `u32`.
    /// **Anyone can call this.**
    pub fn set_balance(env: Env, who: Address, amount: i128) {
        if Self::mode(&env) == MODE_U32 {
            assert!(u32::try_from(amount).is_ok(), "amount does not fit a u32");
        }
        env.storage().persistent().set(&who, &amount);
    }

    /// The balance of `id`, in the shape chosen by the mode. An address that was never set has 0.
    pub fn balance(env: Env, id: Address) -> Val {
        let amount: i128 = env.storage().persistent().get(&id).unwrap_or(0);
        match Self::mode(&env) {
            MODE_I128 => amount.into_val(&env),
            MODE_U32 => (amount as u32).into_val(&env),
            MODE_U64 => 5u64.into_val(&env),
            _ => panic!("this token always fails"),
        }
    }
}

impl MockToken {
    fn mode(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("mode"))
            .unwrap()
    }
}
