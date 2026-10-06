use soroban_sdk::{contracterror, contractevent, contracttype, Address, Vec};

/// Upper bound on conditions in one policy. Each condition is one call into code the policy owner
/// chose, so the bound keeps a policy reviewable. Measured costs would allow more.
pub const MAX_CONDITIONS: u32 = 8;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No policy with this id.
    PolicyNotFound = 1,
    /// A policy needs at least one condition.
    NoConditions = 2,
    /// More than `MAX_CONDITIONS` conditions.
    TooManyConditions = 3,
    /// A minimum balance must be greater than zero.
    InvalidMinimum = 4,
    /// A time window needs at least one bound, and `not_before` must be earlier than `not_after`.
    InvalidTimeWindow = 5,
    /// A token or collection address is not a deployed contract.
    NotAContract = 6,
}

/// Holds at least `min` of a SEP-41 style token, read with `balance(Address) -> i128`.
/// `min` is in the token's base units, not display units.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenBalanceCond {
    pub token: Address,
    pub min: i128,
}

/// Holds at least `min` items of a SEP-50 style collection, read with `balance(Address) -> u32`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NftBalanceCond {
    pub collection: Address,
    pub min: u32,
}

/// The ledger time is in `[not_before, not_after)`, in unix seconds. `None` leaves that side open.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimeWindowCond {
    pub not_before: Option<u64>,
    pub not_after: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Condition {
    TokenBalance(TokenBalanceCond),
    NftBalance(NftBalanceCond),
    TimeWindow(TimeWindowCond),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    pub owner: Address,
    /// Starts at 1 and increases by one on every `update`. Not changed by `set_active`.
    pub version: u32,
    pub active: bool,
    /// All conditions must hold (AND), evaluated in this order.
    pub conditions: Vec<Condition>,
}

/// Why a decision is a denial. Encoded as an integer; the codes are part of the public interface.
/// (A plain field rather than an `Option`: the SDK cannot convert an `Option` of a custom enum inside a
/// stored struct.)
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DenyReason {
    /// Not denied. This is the reason exactly when `Decision::allowed` is true.
    None = 0,
    /// The policy was deactivated by its owner.
    Inactive = 1,
    /// A balance was read successfully and is below the minimum.
    BelowMinimum = 2,
    /// The token or collection raised an error or returned an unexpected type. For classic assets this
    /// includes "no trustline": a Stellar asset contract raises an error rather than returning 0.
    BalanceUnavailable = 3,
    /// The ledger time is earlier than `not_before`.
    BeforeWindow = 4,
    /// The ledger time is at or after `not_after`.
    AfterWindow = 5,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Decision {
    pub allowed: bool,
    /// The policy version that was evaluated.
    pub version: u32,
    /// Index of the first failing condition. `None` when allowed, or when the policy is inactive.
    pub failed_index: Option<u32>,
    /// `DenyReason::None` exactly when `allowed` is true.
    pub reason: DenyReason,
}

#[contractevent(topics = ["access_policy", "created"])]
pub struct Created {
    #[topic]
    pub id: u64,
    pub owner: Address,
    pub version: u32,
}

#[contractevent(topics = ["access_policy", "updated"])]
pub struct Updated {
    #[topic]
    pub id: u64,
    pub version: u32,
}

#[contractevent(topics = ["access_policy", "active_changed"])]
pub struct ActiveChanged {
    #[topic]
    pub id: u64,
    pub active: bool,
}
