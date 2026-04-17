// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Proof modalities supported by the protocol.
enum ProofType {
    ORACLE,     // 0 — ECDSA signature from a registered off-chain attestor
    TEE,        // 1 — Trusted Execution Environment remote attestation
    ZKTLS,      // 2 — zkTLS proof of an HTTPS response
    COSIGN,     // 3 — Buyer countersignature over (paymentId, resultHash)
    THRESHOLD,  // 4 — M-of-N independent attestor signatures
    TIMEOUT     // 5 — No buyer refund before challenge window closes
}

/// @notice The canonical on-chain record that a delivery occurred.
struct Quittance {
    /// @dev keccak256(buyer, seller, amount, deliveryDeadline, authNonce)
    bytes32 paymentId;
    /// @dev keccak256 of the canonical request the buyer paid for
    bytes32 requestHash;
    /// @dev keccak256 of the delivered artifact
    bytes32 resultHash;
    address sellerPassport;
    address buyerPassport;
    ProofType proofType;
    /// @dev Proof-type-specific bytes (signature, attestation, etc.)
    bytes proofPayload;
    /// @dev Who produced the proof (oracle EOA, TEE address, etc.)
    address attestor;
    uint64 deliveredAt;
    uint64 deadline;
}
