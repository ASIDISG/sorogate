#![no_std]
//! Stored, owner-controlled access policies that other contracts can evaluate.
//!
//! `evaluate` answers "does `subject` satisfy policy `id` right now?". It does **not** authenticate
//! `subject`: a consumer must call `subject.require_auth()` itself before acting on the answer.
//! The rules are specified in `spec/SPEC.md`.
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

mod eval;
mod types;

#[cfg(test)]
mod test;

pub use types::*;

const DAY_IN_LEDGERS: u32 = 17_280;
/// Policies are topped up to 90 days. The network maximum is 3,110,400 ledgers (about 180 days).
const TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;

#[contracttype]
pub(crate) enum DataKey {
    NextId,
    Policy(u64),
}

fn load(env: &Env, id: u64) -> Result<Policy, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(id))
        .ok_or(Error::PolicyNotFound)
}

fn save(env: &Env, id: u64, policy: &Policy) {
    let key = DataKey::Policy(id);
    env.storage().persistent().set(&key, policy);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

#[contract]
pub struct AccessPolicy;

#[contractimpl]
impl AccessPolicy {
    /// Creates a policy owned by `owner` and returns its id. Ids start at 1.
    pub fn create(env: Env, owner: Address, conditions: Vec<Condition>) -> Result<u64, Error> {
        owner.require_auth();
        eval::validate(&conditions)?;

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        let policy = Policy {
            owner: owner.clone(),
            version: 1,
            active: true,
            conditions,
        };
        save(&env, id, &policy);
        Created {
            id,
            owner,
            version: 1,
        }
        .publish(&env);
        Ok(id)
    }

    /// Replaces the conditions of a policy and increases its version by one. Owner only.
    pub fn update(env: Env, id: u64, conditions: Vec<Condition>) -> Result<(), Error> {
        let mut policy = load(&env, id)?;
        policy.owner.require_auth();
        eval::validate(&conditions)?;

        policy.conditions = conditions;
        policy.version += 1;
        save(&env, id, &policy);
        Updated {
            id,
            version: policy.version,
        }
        .publish(&env);
        Ok(())
    }

    /// Deactivates or reactivates a policy. An inactive policy denies everyone. Owner only.
    pub fn set_active(env: Env, id: u64, active: bool) -> Result<(), Error> {
        let mut policy = load(&env, id)?;
        policy.owner.require_auth();

        policy.active = active;
        save(&env, id, &policy);
        ActiveChanged { id, active }.publish(&env);
        Ok(())
    }

    /// Returns the stored policy.
    pub fn get(env: Env, id: u64) -> Result<Policy, Error> {
        load(&env, id)
    }

    /// Whether `subject` satisfies policy `id` at the current ledger time. Read-only, needs no
    /// authorization, and does not prove that the caller controls `subject`.
    pub fn evaluate(env: Env, id: u64, subject: Address) -> Result<Decision, Error> {
        let policy = load(&env, id)?;
        let version = policy.version;

        if !policy.active {
            return Ok(Decision {
                allowed: false,
                version,
                failed_index: None,
                reason: DenyReason::Inactive,
            });
        }

        let now = env.ledger().timestamp();
        Ok(
            match eval::first_failure(&env, &policy.conditions, &subject, now) {
                None => Decision {
                    allowed: true,
                    version,
                    failed_index: None,
                    reason: DenyReason::None,
                },
                Some((index, reason)) => Decision {
                    allowed: false,
                    version,
                    failed_index: Some(index),
                    reason,
                },
            },
        )
    }

    /// Extends the lifetime of a policy and of this contract. Anyone may call it.
    pub fn bump(env: Env, id: u64) -> Result<(), Error> {
        let key = DataKey::Policy(id);
        if !env.storage().persistent().has(&key) {
            return Err(Error::PolicyNotFound);
        }
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_EXTEND_TO, TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(TTL_EXTEND_TO, TTL_EXTEND_TO);
        Ok(())
    }
}
