use soroban_sdk::{testutils::Address as _, Address, Env, TryFromVal, Val};

use crate::{MockToken, MockTokenClient, MODE_I128, MODE_PANICS, MODE_U32, MODE_U64};

fn deploy(env: &Env, mode: u32) -> MockTokenClient<'_> {
    MockTokenClient::new(env, &env.register(MockToken, (mode,)))
}

fn as_i128(env: &Env, v: Val) -> Option<i128> {
    i128::try_from_val(env, &v).ok()
}
fn as_u32(env: &Env, v: Val) -> Option<u32> {
    u32::try_from_val(env, &v).ok()
}
fn as_u64(env: &Env, v: Val) -> Option<u64> {
    u64::try_from_val(env, &v).ok()
}

#[test]
fn i128_mode_returns_the_stored_amount_and_zero_for_strangers() {
    let env = Env::default();
    let token = deploy(&env, MODE_I128);
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));
    token.set_balance(&alice, &123);

    assert_eq!(as_i128(&env, token.balance(&alice)), Some(123));
    assert_eq!(as_i128(&env, token.balance(&bob)), Some(0));
    // It is an i128 and nothing else.
    assert_eq!(as_u32(&env, token.balance(&alice)), None);
    assert_eq!(as_u64(&env, token.balance(&alice)), None);
}

#[test]
fn i128_mode_holds_the_largest_amount() {
    let env = Env::default();
    let token = deploy(&env, MODE_I128);
    let whale = Address::generate(&env);
    token.set_balance(&whale, &i128::MAX);
    assert_eq!(as_i128(&env, token.balance(&whale)), Some(i128::MAX));
}

#[test]
fn u32_mode_returns_a_u32_and_nothing_else() {
    let env = Env::default();
    let token = deploy(&env, MODE_U32);
    let alice = Address::generate(&env);
    token.set_balance(&alice, &7);

    assert_eq!(as_u32(&env, token.balance(&alice)), Some(7));
    assert_eq!(as_i128(&env, token.balance(&alice)), None);
    assert_eq!(as_u64(&env, token.balance(&alice)), None);
}

#[test]
fn u32_mode_refuses_an_amount_that_does_not_fit() {
    let env = Env::default();
    let token = deploy(&env, MODE_U32);
    let alice = Address::generate(&env);
    token.set_balance(&alice, &(u32::MAX as i128));
    assert!(token
        .try_set_balance(&alice, &(u32::MAX as i128 + 1))
        .is_err());
    assert!(token.try_set_balance(&alice, &-1).is_err());
    assert_eq!(as_u32(&env, token.balance(&alice)), Some(u32::MAX));
}

#[test]
fn u64_mode_returns_a_u64_whatever_was_set() {
    let env = Env::default();
    let token = deploy(&env, MODE_U64);
    let alice = Address::generate(&env);
    token.set_balance(&alice, &1_000);
    assert_eq!(as_u64(&env, token.balance(&alice)), Some(5));
    assert_eq!(as_i128(&env, token.balance(&alice)), None);
    assert_eq!(as_u32(&env, token.balance(&alice)), None);
}

#[test]
fn the_panicking_mode_always_fails() {
    let env = Env::default();
    let token = deploy(&env, MODE_PANICS);
    assert!(token.try_balance(&Address::generate(&env)).is_err());
}

#[test]
#[should_panic]
fn an_unknown_mode_cannot_be_deployed() {
    let env = Env::default();
    env.register(MockToken, (4u32,));
}
