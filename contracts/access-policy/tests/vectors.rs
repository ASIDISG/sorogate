//! Runs the shared test vectors in `spec/vectors` against the real contract. The TypeScript model in
//! `packages/sdk` runs the same files; if the two disagree on a case, one of them has a bug.
//! The format is described in `spec/vectors/README.md`.
use std::{collections::BTreeMap, fs};

use access_policy::{
    AccessPolicy, AccessPolicyClient, Condition, Decision, DenyReason, Error, NftBalanceCond,
    TimeWindowCond, TokenBalanceCond,
};
use serde_json::Value;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, EnvTestConfig, Ledger as _},
    Address, Env, Vec,
};

// ------------------------------------------------------------------ mock contracts, one per token `kind`

#[contract]
pub struct MockI128;

#[contractimpl]
impl MockI128 {
    pub fn set_balance(env: Env, who: Address, amount: i128) {
        env.storage().persistent().set(&who, &amount);
    }
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().persistent().get(&id).unwrap_or(0)
    }
}

#[contract]
pub struct MockU32;

#[contractimpl]
impl MockU32 {
    pub fn set_balance(env: Env, who: Address, amount: u32) {
        env.storage().persistent().set(&who, &amount);
    }
    pub fn balance(env: Env, id: Address) -> u32 {
        env.storage().persistent().get(&id).unwrap_or(0)
    }
}

#[contract]
pub struct MockU64;

#[contractimpl]
impl MockU64 {
    pub fn balance(_env: Env, _id: Address) -> u64 {
        5
    }
}

#[contract]
pub struct MockPanics;

#[contractimpl]
impl MockPanics {
    pub fn balance(_env: Env, _id: Address) -> i128 {
        panic!("boom")
    }
}

// ------------------------------------------------------------------ reading the vector files

fn load(file: &str) -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/vectors/");
    let text = fs::read_to_string(format!("{path}{file}"))
        .unwrap_or_else(|e| panic!("cannot read {file}: {e}"));
    let value: Value =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{file} is not valid JSON: {e}"));
    assert_eq!(value["schema"], 1, "{file}: unknown schema version");
    value
}

fn text(v: &Value) -> &str {
    v.as_str()
        .unwrap_or_else(|| panic!("expected a string, got {v}"))
}

fn optional_u64(v: &Value) -> Option<u64> {
    if v.is_null() {
        None
    } else {
        Some(text(v).parse().unwrap_or_else(|_| panic!("not a u64: {v}")))
    }
}

fn deny_reason(name: &str) -> DenyReason {
    match name {
        "None" => DenyReason::None,
        "Inactive" => DenyReason::Inactive,
        "BelowMinimum" => DenyReason::BelowMinimum,
        "BalanceUnavailable" => DenyReason::BalanceUnavailable,
        "BeforeWindow" => DenyReason::BeforeWindow,
        "AfterWindow" => DenyReason::AfterWindow,
        other => panic!("unknown deny reason {other}"),
    }
}

fn contract_error(name: &str) -> Error {
    match name {
        "PolicyNotFound" => Error::PolicyNotFound,
        "NoConditions" => Error::NoConditions,
        "TooManyConditions" => Error::TooManyConditions,
        "InvalidMinimum" => Error::InvalidMinimum,
        "InvalidTimeWindow" => Error::InvalidTimeWindow,
        "NotAContract" => Error::NotAContract,
        other => panic!("unknown error {other}"),
    }
}

// ------------------------------------------------------------------ building a world from a vector

struct World {
    tokens: BTreeMap<String, Address>,
    subjects: BTreeMap<String, Address>,
}

fn build_world(
    env: &Env,
    policy_contract: &Address,
    tokens: &Value,
    extra_subjects: &[&str],
) -> World {
    let mut names: std::collections::BTreeSet<String> =
        extra_subjects.iter().map(|s| s.to_string()).collect();
    for (_, def) in tokens.as_object().expect("tokens must be an object") {
        if let Some(balances) = def.get("balances").and_then(Value::as_object) {
            names.extend(balances.keys().cloned());
        }
    }
    let subjects: BTreeMap<String, Address> = names
        .into_iter()
        .map(|n| (n, Address::generate(env)))
        .collect();

    let mut addresses = BTreeMap::new();
    for (name, def) in tokens.as_object().unwrap() {
        let kind = text(&def["kind"]);
        let address = match kind {
            "i128" => {
                let a = env.register(MockI128, ());
                let client = MockI128Client::new(env, &a);
                for (who, amount) in def
                    .get("balances")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                {
                    client.set_balance(
                        &subjects[who],
                        &text(amount).parse::<i128>().expect("i128 balance"),
                    );
                }
                a
            }
            "u32" => {
                let a = env.register(MockU32, ());
                let client = MockU32Client::new(env, &a);
                for (who, amount) in def
                    .get("balances")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                {
                    client.set_balance(
                        &subjects[who],
                        &(amount.as_u64().expect("u32 balance") as u32),
                    );
                }
                a
            }
            "u64" => env.register(MockU64, ()),
            "panics" => env.register(MockPanics, ()),
            // A deployed contract that has no `balance` function: the policy contract itself.
            "no_balance_function" => policy_contract.clone(),
            "account" => Address::from_str(
                env,
                "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L",
            ),
            // A well-formed contract address with nothing deployed at it.
            "missing" => Address::generate(env),
            other => panic!("unknown token kind {other}"),
        };
        addresses.insert(name.clone(), address);
    }
    World {
        tokens: addresses,
        subjects,
    }
}

fn condition(world: &World, json: &Value) -> Condition {
    match text(&json["type"]) {
        "token_balance" => Condition::TokenBalance(TokenBalanceCond {
            token: world.tokens[text(&json["token"])].clone(),
            min: text(&json["min"]).parse().expect("i128 minimum"),
        }),
        "nft_balance" => Condition::NftBalance(NftBalanceCond {
            collection: world.tokens[text(&json["collection"])].clone(),
            min: json["min"].as_u64().expect("u32 minimum") as u32,
        }),
        "time_window" => Condition::TimeWindow(TimeWindowCond {
            not_before: optional_u64(&json["notBefore"]),
            not_after: optional_u64(&json["notAfter"]),
        }),
        other => panic!("unknown condition type {other}"),
    }
}

fn conditions(env: &Env, world: &World, list: &Value) -> Vec<Condition> {
    let items: std::vec::Vec<Condition> = list
        .as_array()
        .expect("conditions must be an array")
        .iter()
        .map(|j| condition(world, j))
        .collect();
    Vec::from_slice(env, &items)
}

/// One environment per test, one new policy contract (ids start at 1) and new mock tokens per case; cases share the
/// environment but not contracts.
///
/// The snapshot written when an environment is dropped is switched off: with 70 cases of contracts in one ledger it
/// takes minutes to write, and nothing reads it.
fn shared_env() -> Env {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    env
}

// ------------------------------------------------------------------ the tests

#[test]
fn evaluate_vectors() {
    let file = load("evaluate.json");
    let env = shared_env();
    let cases = file["cases"].as_array().expect("cases");
    assert!(!cases.is_empty());
    let mut failures = std::vec::Vec::new();

    for case in cases {
        let name = text(&case["name"]);
        let contract = env.register(AccessPolicy, ());
        let client = AccessPolicyClient::new(&env, &contract);
        let subject_name = text(&case["subject"]);
        let world = build_world(&env, &client.address, &file["tokens"], &[subject_name]);

        let owner = Address::generate(&env);
        let list = conditions(&env, &world, &case["policy"]["conditions"]);
        let id = client.create(&owner, &list);
        let updates = case["policy"]
            .get("extraUpdates")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        for _ in 0..updates {
            client.update(&id, &list);
        }
        if case["policy"].get("active").and_then(Value::as_bool) == Some(false) {
            client.set_active(&id, &false);
        }
        let timestamp: u64 = case
            .get("timestamp")
            .map(|t| text(t).parse().expect("u64 timestamp"))
            .unwrap_or(0);
        env.ledger().with_mut(|l| l.timestamp = timestamp);

        let expected = Decision {
            allowed: case["expect"]["allowed"].as_bool().unwrap(),
            version: case["expect"]["version"].as_u64().unwrap() as u32,
            failed_index: case["expect"]["failedIndex"].as_u64().map(|i| i as u32),
            reason: deny_reason(text(&case["expect"]["reason"])),
        };
        let actual = client.evaluate(&id, &world.subjects[subject_name]);
        if actual != expected {
            failures.push(format!(
                "{name}\n    expected {expected:?}\n    actual   {actual:?}"
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} vectors failed:\n  {}",
        failures.len(),
        cases.len(),
        failures.join("\n  ")
    );
}

#[test]
fn validate_vectors() {
    let file = load("validate.json");
    let env = shared_env();
    let cases = file["cases"].as_array().expect("cases");
    assert!(!cases.is_empty());
    let mut failures = std::vec::Vec::new();

    for case in cases {
        let name = text(&case["name"]);
        let contract = env.register(AccessPolicy, ());
        let client = AccessPolicyClient::new(&env, &contract);
        let world = build_world(&env, &client.address, &file["tokens"], &[]);
        let owner = Address::generate(&env);
        let list = conditions(&env, &world, &case["conditions"]);

        let result = client.try_create(&owner, &list);
        let ok = case["expect"]["ok"].as_bool().unwrap();
        let matches = if ok {
            matches!(result, Ok(Ok(_)))
        } else {
            result == Err(Ok(contract_error(text(&case["expect"]["error"]))))
        };
        if !matches {
            failures.push(format!(
                "{name}\n    expected {}\n    actual   {result:?}",
                case["expect"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} vectors failed:\n  {}",
        failures.len(),
        cases.len(),
        failures.join("\n  ")
    );
}
