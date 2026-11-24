use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),
    #[error("unauthorized")]
    Unauthorized,
    #[error("unknown id")]
    UnknownId,
    #[error("bad rail")]
    BadRail,
    #[error("bad leaf")]
    BadLeaf,
    #[error("leaf already registered")]
    LeafExists,
    #[error("raffle not drawable")]
    NotDrawable,
    #[error("randomness contract is not configured")]
    NoOracle,
    #[error("draw already pending or finished")]
    DrawBusy,
    #[error("knowledge proof is pending")]
    KnowledgeProofPending,
    #[error("invalid domain")]
    InvalidDomain,
    #[error("invalid door-auth public key")]
    BadPubkey,
    #[error("eth and base rails are not accepted")]
    ForbiddenRail,
    #[error("invalid metadata hash")]
    BadMetadataHash,
    #[error("invalid nip-52 kind")]
    BadKind,
    #[error("zkid is unset; consume is fail-closed")]
    ZkidUnset,
    #[error("service key is not configured")]
    NoServiceKey,
    #[error("admin FROST verifying key is not configured")]
    NoGuestRootVk,
    #[error("admin FROST signature is missing or invalid")]
    BadFrostSignature,
    #[error("usher group is not configured")]
    NoUsherGroup,
    #[error("unknown or historical root is missing")]
    UnknownRoot,
    #[error("root epoch must increase")]
    EpochNotMonotonic,
    #[error("leaf count must not decrease")]
    LeafCountDecreased,
    #[error("nullifier already spent")]
    NullifierSpent,
    #[error("bad field element or public input")]
    BadPublicInput,
    #[error("public input length is invalid")]
    BadLength,
    #[error("event or domain does not match this contract")]
    WrongEvent,
    #[error("ticket rejected: {0}")]
    TicketRejected(String),
}
