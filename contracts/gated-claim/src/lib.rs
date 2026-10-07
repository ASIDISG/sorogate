#![no_std]
//! A reference consumer of an access policy: it pays a fixed amount of a token, once, to every address that
//! satisfies a policy.
//!
//! It exists to show the pattern, which is short and has an order that matters:
//!
//! 1. **Authenticate the subject.** `subject.require_auth()`. The policy contract's `evaluate` answers for any address
//!    it is given and does not prove who is asking; without this line anyone could claim for any qualifying address.
//! 2. **Ask the policy contract** whether the subject qualifies, and fail closed if it cannot answer.
//! 3. **Optionally pin the policy version**, so a policy owner cannot change the rules under this contract unnoticed.
//! 4. **Record the claim before paying**, so a failure after this point reverts both.
//!
//! The policy contract's interface is declared here by hand, as any consumer would: this crate does not depend on the
//! policy contract's code. Its tests run against the real policy contract to keep the two in step.
//!
//! **This is a demonstration, not a product.** There is no withdrawal and no administrator: fund it only with a
//! test asset you can afford to lose.
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, token,
    Address, Env,
};

#[cfg(test)]
mod test;

const DAY_IN_LEDGERS: u32 = 17_280;
/// A claim is remembered for 90 days at a time. A forgotten claim is archived, not erased, and has to be restored
/// before anyone can use that key again, so it cannot be claimed twice.
const CLAIM_TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;
const CLAIM_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;

// ---------------------------------------------------------------- the policy contract's interface

/// Why a policy denied someone. The codes are the policy contract's, and are part of its interface.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DenyReason {
    None = 0,
    Inactive = 1,
    BelowMinimum = 2,
    BalanceUnavailable = 3,
    BeforeWindow = 4,
    AfterWindow = 5,
}

/// What the policy contract's `evaluate` returns.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Decision {
    pub allowed: bool,
    pub version: u32,
    pub failed_index: Option<u32>,
    pub reason: DenyReason,
}

#[contractclient(name = "PolicyClient")]
pub trait PolicyInterface {
    fn evaluate(env: Env, id: u64, subject: Address) -> Decision;
}

// ---------------------------------------------------------------- this contract

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// This address has already claimed.
    AlreadyClaimed = 1,
    /// The policy contract could not answer: wrong address, unknown policy id, or a failure inside it.
    PolicyUnavailable = 2,
    /// The policy was changed since this contract was set up to expect a particular version.
    PolicyChanged = 3,
    /// The amount to pay must be greater than zero.
    InvalidAmount = 4,
    // Denials: the policy said no. These mirror `DenyReason`, so a caller can tell why.
    Inactive = 10,
    BelowMinimum = 11,
    BalanceUnavailable = 12,
    BeforeWindow = 13,
    AfterWindow = 14,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub policy_contract: Address,
    pub policy_id: u64,
    pub reward_token: Address,
    /// Paid to each address that claims, in the token's base units.
    pub amount: i128,
    /// When set, the policy must still be at exactly this version.
    pub pinned_version: Option<u32>,
}

#[contracttype]
enum DataKey {
    Config,
    Claimed(Address),
}

#[contractevent(topics = ["gated_claim", "claimed"])]
pub struct Claimed {
    #[topic]
    pub subject: Address,
    pub amount: i128,
    /// The version of the policy the claim was checked against.
    pub policy_version: u32,
}

fn config(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

#[contract]
pub struct GatedClaim;

#[contractimpl]
impl GatedClaim {
    /// Sets up the consumer, once. `pinned_version` of `None` follows whatever the policy owner does.
    pub fn __constructor(
        env: Env,
        policy_contract: Address,
        policy_id: u64,
        reward_token: Address,
        amount: i128,
        pinned_version: Option<u32>,
    ) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let config = Config {
            policy_contract,
            policy_id,
            reward_token,
            amount,
            pinned_version,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    /// Pays `config().amount` of the reward token to `subject`, once, if the policy allows them.
    pub fn claim(env: Env, subject: Address) -> Result<(), Error> {
        // 1. Prove the caller is the subject. Everything below is about what the subject is entitled to.
        subject.require_auth();

        let config = config(&env);
        let key = DataKey::Claimed(subject.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyClaimed);
        }

        // 2. Ask the policy. Any failure to get an answer is a refusal, never a pass.
        let decision = match PolicyClient::new(&env, &config.policy_contract)
            .try_evaluate(&config.policy_id, &subject)
        {
            Ok(Ok(decision)) => decision,
            _ => return Err(Error::PolicyUnavailable),
        };

        // 3. If this contract was set up for one version of the policy, refuse any other.
        if let Some(pinned) = config.pinned_version {
            if decision.version != pinned {
                return Err(Error::PolicyChanged);
            }
        }
        if !decision.allowed {
            return Err(match decision.reason {
                DenyReason::Inactive => Error::Inactive,
                DenyReason::BelowMinimum => Error::BelowMinimum,
                DenyReason::BalanceUnavailable => Error::BalanceUnavailable,
                DenyReason::BeforeWindow => Error::BeforeWindow,
                DenyReason::AfterWindow => Error::AfterWindow,
                // `allowed` false with reason `None` breaks the policy contract's own rule; do not pay.
                DenyReason::None => Error::PolicyUnavailable,
            });
        }

        // 4. Record the claim first, then pay. If the payment fails, the whole call reverts, record included.
        env.storage()
            .persistent()
            .set(&key, &env.ledger().sequence());
        env.storage()
            .persistent()
            .extend_ttl(&key, CLAIM_TTL_THRESHOLD, CLAIM_TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(CLAIM_TTL_THRESHOLD, CLAIM_TTL_EXTEND_TO);

        token::Client::new(&env, &config.reward_token).transfer(
            &env.current_contract_address(),
            &subject,
            &config.amount,
        );
        Claimed {
            subject,
            amount: config.amount,
            policy_version: decision.version,
        }
        .publish(&env);
        Ok(())
    }

    /// Whether `subject` has claimed.
    pub fn has_claimed(env: Env, subject: Address) -> bool {
        env.storage().persistent().has(&DataKey::Claimed(subject))
    }

    /// What this consumer was set up with.
    pub fn config(env: Env) -> Config {
        config(&env)
    }
}
