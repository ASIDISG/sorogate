extern crate std;

use access_policy::{
    AccessPolicy, AccessPolicyClient, Condition, TimeWindowCond, TokenBalanceCond,
};
use mock_token::{MockToken, MockTokenClient};
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Event as _, IntoVal, Vec,
};

use crate::{Claimed, Config, DataKey, Error, GatedClaim, GatedClaimClient, CLAIM_TTL_EXTEND_TO};

const AMOUNT: i128 = 10;
const POOL: i128 = 1_000;

struct Fixture<'a> {
    env: &'a Env,
    owner: Address,
    policy: AccessPolicyClient<'a>,
    policy_id: u64,
    coin: MockTokenClient<'a>,
    reward: TokenClient<'a>,
    consumer: GatedClaimClient<'a>,
}

fn coin_condition(coin: &Address, min: i128) -> Condition {
    Condition::TokenBalance(TokenBalanceCond {
        token: coin.clone(),
        min,
    })
}

/// A policy "holds at least `min` of the coin", and a consumer paying `AMOUNT` of a reward token from a pool.
fn fixture(env: &Env, min: i128, pinned: Option<u32>) -> Fixture<'_> {
    let coin = env.register(MockToken, (0u32,));
    fixture_with(
        env,
        |_| std::vec![coin_condition(&coin, min)],
        coin.clone(),
        pinned,
        AMOUNT,
        POOL,
    )
}

fn fixture_with<'a>(
    env: &'a Env,
    conditions: impl FnOnce(&Env) -> std::vec::Vec<Condition>,
    coin: Address,
    pinned: Option<u32>,
    amount: i128,
    pool: i128,
) -> Fixture<'a> {
    env.mock_all_auths();
    let policy_address = env.register(AccessPolicy, ());
    let policy = AccessPolicyClient::new(env, &policy_address);
    let owner = Address::generate(env);
    let policy_id = policy.create(&owner, &Vec::from_slice(env, &conditions(env)));

    let reward_address = env
        .register_stellar_asset_contract_v2(Address::generate(env))
        .address();
    let consumer_address = env.register(
        GatedClaim,
        (
            policy_address,
            policy_id,
            reward_address.clone(),
            amount,
            pinned,
        ),
    );
    StellarAssetClient::new(env, &reward_address).mint(&consumer_address, &pool);

    Fixture {
        env,
        owner,
        policy,
        policy_id,
        coin: MockTokenClient::new(env, &coin),
        reward: TokenClient::new(env, &reward_address),
        consumer: GatedClaimClient::new(env, &consumer_address),
    }
}

fn holder_with(f: &Fixture, amount: i128) -> Address {
    let who = Address::generate(f.env);
    f.coin.set_balance(&who, &amount);
    who
}

// ---------------------------------------------------------------- the happy path

#[test]
fn an_eligible_address_is_paid_once() {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let alice = holder_with(&f, 150);

    f.consumer.claim(&alice);

    assert_eq!(f.reward.balance(&alice), AMOUNT);
    assert_eq!(f.reward.balance(&f.consumer.address), POOL - AMOUNT);
    assert!(f.consumer.has_claimed(&alice));
}

#[test]
fn claiming_publishes_an_event_that_names_the_policy_version() {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let alice = holder_with(&f, 100);

    f.consumer.claim(&alice);

    let ours = Claimed {
        subject: alice,
        amount: AMOUNT,
        policy_version: 1,
    }
    .to_xdr(&env, &f.consumer.address);
    assert!(env.events().all().events().contains(&ours));
}

#[test]
fn the_same_address_cannot_claim_twice() {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let alice = holder_with(&f, 150);

    f.consumer.claim(&alice);
    assert_eq!(f.consumer.try_claim(&alice), Err(Ok(Error::AlreadyClaimed)));
    assert_eq!(f.reward.balance(&alice), AMOUNT, "no second payment");
}

#[test]
fn different_addresses_each_get_paid() {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let (a, b) = (holder_with(&f, 100), holder_with(&f, 5000));

    f.consumer.claim(&a);
    f.consumer.claim(&b);
    assert_eq!(f.reward.balance(&a), AMOUNT);
    assert_eq!(f.reward.balance(&b), AMOUNT);
    assert_eq!(f.reward.balance(&f.consumer.address), POOL - 2 * AMOUNT);
}

#[test]
fn a_claim_and_the_contract_are_kept_alive_for_long_enough_that_it_cannot_be_forgotten_and_repeated(
) {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let alice = holder_with(&f, 150);

    f.consumer.claim(&alice);

    env.as_contract(&f.consumer.address, || {
        let claim_ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Claimed(alice.clone()));
        assert!(
            claim_ttl >= CLAIM_TTL_EXTEND_TO,
            "the claim lives {claim_ttl} ledgers"
        );
        assert!(env.storage().instance().get_ttl() >= CLAIM_TTL_EXTEND_TO);
    });
}

// ---------------------------------------------------------------- the point of the primitive

#[test]
fn the_owner_changes_the_rule_and_the_consumer_follows_without_being_redeployed() {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let (before, after) = (holder_with(&f, 150), holder_with(&f, 150));

    f.consumer.claim(&before); // 150 holds at least 100

    // The owner raises the bar to 500. Nothing about the consumer is touched.
    f.policy.update(
        &f.policy_id,
        &Vec::from_slice(&env, &[coin_condition(&f.coin.address, 500)]),
    );

    assert_eq!(f.consumer.try_claim(&after), Err(Ok(Error::BelowMinimum)));
    assert!(!f.consumer.has_claimed(&after));
}

#[test]
fn a_denied_address_can_claim_later_once_it_qualifies() {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let alice = holder_with(&f, 5);

    assert_eq!(f.consumer.try_claim(&alice), Err(Ok(Error::BelowMinimum)));
    assert!(!f.consumer.has_claimed(&alice), "a refusal is not a claim");

    f.coin.set_balance(&alice, &100);
    f.consumer.claim(&alice);
    assert_eq!(f.reward.balance(&alice), AMOUNT);
}

// ---------------------------------------------------------------- each way of being denied

#[test]
fn a_denial_says_why() {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let poor = holder_with(&f, 1);
    assert_eq!(f.consumer.try_claim(&poor), Err(Ok(Error::BelowMinimum)));

    f.policy.set_active(&f.policy_id, &false);
    assert_eq!(f.consumer.try_claim(&poor), Err(Ok(Error::Inactive)));
}

#[test]
fn an_unavailable_balance_is_its_own_denial() {
    let env = Env::default();
    let broken = env.register(MockToken, (3u32,)); // balance always fails
    let f = fixture_with(
        &env,
        |_| std::vec![coin_condition(&broken, 1)],
        broken.clone(),
        None,
        AMOUNT,
        POOL,
    );
    assert_eq!(
        f.consumer.try_claim(&Address::generate(&env)),
        Err(Ok(Error::BalanceUnavailable))
    );
}

#[test]
fn time_windows_are_enforced() {
    let env = Env::default();
    let coin = env.register(MockToken, (0u32,));
    let window = |from: Option<u64>, to: Option<u64>| {
        Condition::TimeWindow(TimeWindowCond {
            not_before: from,
            not_after: to,
        })
    };

    env.ledger().with_mut(|l| l.timestamp = 50);
    let early = fixture_with(
        &env,
        |_| std::vec![window(Some(100), None)],
        coin.clone(),
        None,
        AMOUNT,
        POOL,
    );
    assert_eq!(
        early.consumer.try_claim(&Address::generate(&env)),
        Err(Ok(Error::BeforeWindow))
    );

    env.ledger().with_mut(|l| l.timestamp = 500);
    let late = fixture_with(
        &env,
        |_| std::vec![window(None, Some(100))],
        coin,
        None,
        AMOUNT,
        POOL,
    );
    assert_eq!(
        late.consumer.try_claim(&Address::generate(&env)),
        Err(Ok(Error::AfterWindow))
    );
}

// ---------------------------------------------------------------- authentication

#[test]
fn nobody_can_claim_on_behalf_of_an_address_without_its_authorization() {
    let env = Env::default();
    let f = fixture(&env, 100, None);
    let alice = holder_with(&f, 150);
    let thief = Address::generate(&env);

    // Alice qualifies, but nobody has authorized this call.
    env.mock_auths(&[]);
    assert!(f.consumer.try_claim(&alice).is_err());

    // The thief authorizes a claim for *alice*, which is not alice's authorization.
    env.mock_auths(&[MockAuth {
        address: &thief,
        invoke: &MockAuthInvoke {
            contract: &f.consumer.address,
            fn_name: "claim",
            args: (&alice,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(f.consumer.try_claim(&alice).is_err());

    assert!(!f.consumer.has_claimed(&alice));
    assert_eq!(f.reward.balance(&alice), 0);
}

// ---------------------------------------------------------------- pinning the policy version

#[test]
fn a_pinned_consumer_refuses_a_policy_that_has_changed_and_an_unpinned_one_follows_it() {
    let env = Env::default();
    let f = fixture(&env, 100, Some(1));
    let alice = holder_with(&f, 150);
    f.consumer.claim(&alice); // version 1, as pinned

    // The owner changes the policy. Even a change that keeps alice qualifying is a different version.
    f.policy.update(
        &f.policy_id,
        &Vec::from_slice(&env, &[coin_condition(&f.coin.address, 10)]),
    );
    let bob = holder_with(&f, 150);
    assert_eq!(f.consumer.try_claim(&bob), Err(Ok(Error::PolicyChanged)));
    assert!(!f.consumer.has_claimed(&bob));

    // A consumer that was not pinned accepts version 2.
    let g = fixture(&env, 100, None);
    let carol = holder_with(&g, 150);
    g.policy.update(
        &g.policy_id,
        &Vec::from_slice(&env, &[coin_condition(&g.coin.address, 10)]),
    );
    g.consumer.claim(&carol);
    assert_eq!(g.reward.balance(&carol), AMOUNT);
}

#[test]
fn the_pin_is_checked_before_eligibility() {
    let env = Env::default();
    let f = fixture(&env, 100, Some(1));
    f.policy.update(
        &f.policy_id,
        &Vec::from_slice(&env, &[coin_condition(&f.coin.address, 500)]),
    );
    // Not eligible under version 2 either, but the reason reported is that the policy is not the one expected.
    let poor = holder_with(&f, 1);
    assert_eq!(f.consumer.try_claim(&poor), Err(Ok(Error::PolicyChanged)));
}

// ---------------------------------------------------------------- failing safely

#[test]
fn an_unknown_policy_or_a_wrong_policy_contract_is_a_refusal() {
    let env = Env::default();
    env.mock_all_auths();
    let policy = env.register(AccessPolicy, ());
    let reward = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let alice = Address::generate(&env);

    let unknown_id = GatedClaimClient::new(
        &env,
        &env.register(
            GatedClaim,
            (policy, 99u64, reward.clone(), AMOUNT, None::<u32>),
        ),
    );
    assert_eq!(
        unknown_id.try_claim(&alice),
        Err(Ok(Error::PolicyUnavailable))
    );

    let nothing_there = Address::generate(&env);
    let wrong_contract = GatedClaimClient::new(
        &env,
        &env.register(
            GatedClaim,
            (nothing_there, 1u64, reward, AMOUNT, None::<u32>),
        ),
    );
    assert_eq!(
        wrong_contract.try_claim(&alice),
        Err(Ok(Error::PolicyUnavailable))
    );
}

#[test]
fn an_empty_pool_reverts_the_claim_so_it_can_be_retried_after_funding() {
    let env = Env::default();
    let coin = env.register(MockToken, (0u32,));
    let f = fixture_with(
        &env,
        |_| std::vec![coin_condition(&coin, 1)],
        coin.clone(),
        None,
        AMOUNT,
        0,
    );
    let alice = holder_with(&f, 5);

    assert!(f.consumer.try_claim(&alice).is_err());
    assert!(
        !f.consumer.has_claimed(&alice),
        "the failed payment must not leave a claim behind"
    );

    StellarAssetClient::new(&env, &f.reward.address).mint(&f.consumer.address, &AMOUNT);
    f.consumer.claim(&alice);
    assert_eq!(f.reward.balance(&alice), AMOUNT);
}

// ---------------------------------------------------------------- setup

#[test]
fn the_constructor_refuses_an_amount_that_is_not_positive() {
    let env = Env::default();
    let (policy, reward) = (Address::generate(&env), Address::generate(&env));
    for bad in [0i128, -1] {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(
                GatedClaim,
                (policy.clone(), 1u64, reward.clone(), bad, None::<u32>),
            );
        }));
        assert!(result.is_err(), "amount {bad} must be refused");
    }
}

#[test]
fn config_reports_what_the_consumer_was_set_up_with() {
    let env = Env::default();
    let f = fixture(&env, 100, Some(1));
    assert_eq!(
        f.consumer.config(),
        Config {
            policy_contract: f.policy.address.clone(),
            policy_id: f.policy_id,
            reward_token: f.reward.address.clone(),
            amount: AMOUNT,
            pinned_version: Some(1),
        }
    );
    let _ = &f.owner;
}
