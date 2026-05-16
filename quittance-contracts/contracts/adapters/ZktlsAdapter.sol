// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../types/QuittanceTypes.sol";
import "../interfaces/IProofAdapter.sol";

/// @notice Tier-2 honest-mock zkTLS adapter.
///
///         In production, this adapter would verify a zkTLS proof (Reclaim /
///         TLSNotary) that a specific HTTPS response was received from a claimed
///         origin URL. The proof cryptographically binds the TLS session
///         transcript to the result hash without revealing private data.
///
///         For v0, this adapter implements the HONESTY RULE (spec §5.5.1):
///           - All proofs MUST carry MOCK_FLAG (0xFF) as proofPayload[0].
///           - proofPayload is signed by a registered project-controlled attestor.
///           - The adapter emits MockAttestation on every successful verify.
///           - The off-chain attestor calls the real Reclaim testnet verifier
///             (https://demo-zktls.quittance.xyz) and embeds the session
///             commitment in the payload.
///
///         proofPayload encoding:
///           bytes1  MOCK_FLAG (0xFF)
///           bytes32 tlsSessionCommitment  — Reclaim session hash / TLSNotary notarization ID
///           bytes32 originUrlHash         — keccak256 of the claimed origin URL
///           bytes   attestorSig           — 65-byte ECDSA sig over:
///                                           keccak256(abi.encode(
///                                             paymentId, resultHash,
///                                             tlsSessionCommitment, originUrlHash
///                                           ))
///
///         The `q.attestor` field must match the recovered signer and be registered.
contract ZktlsAdapter is Ownable, IProofAdapter {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes1 public constant MOCK_FLAG = 0xFF;

    mapping(address => bool) public registeredAttestors;

    event AttestorRegistered(address indexed attestor);
    event AttestorRevoked(address indexed attestor);

    /// @notice Emitted on every successful verification (honesty rule).
    event MockAttestation(
        bytes32 indexed paymentId,
        bytes32 tlsSessionCommitment,
        bytes32 originUrlHash,
        address attestor,
        string  reason
    );

    constructor() Ownable(msg.sender) {}

    function registerAttestor(address attestor) external onlyOwner {
        require(attestor != address(0), "Zktls: zero address");
        registeredAttestors[attestor] = true;
        emit AttestorRegistered(attestor);
    }

    function revokeAttestor(address attestor) external onlyOwner {
        registeredAttestors[attestor] = false;
        emit AttestorRevoked(attestor);
    }

    /// @inheritdoc IProofAdapter
    function verify(Quittance calldata q) external view override returns (bool) {
        return _verify(q);
    }

    /// @notice Non-view entry point for the off-chain attestor to verify
    ///         and emit the MockAttestation event in one transaction.
    function verifyAndEmit(Quittance calldata q) external returns (bool ok) {
        ok = _verify(q);
        if (ok) {
            (, bytes32 commitment, bytes32 urlHash,) = _decode(q.proofPayload);
            emit MockAttestation(
                q.paymentId,
                commitment,
                urlHash,
                q.attestor,
                "Tier-2 honest mock: Reclaim testnet session commitment embedded in payload"
            );
        }
    }

    function _verify(Quittance calldata q) internal view returns (bool) {
        // MOCK_FLAG (1) + tlsSessionCommitment (32) + originUrlHash (32) + sig (65) = 130
        if (q.proofPayload.length < 130) return false;
        if (bytes1(q.proofPayload[0]) != MOCK_FLAG) return false;

        (bool decoded, bytes32 commitment, bytes32 urlHash, bytes memory sig) = _decode(q.proofPayload);
        if (!decoded)          return false;
        if (sig.length != 65)  return false;

        bytes32 digest = keccak256(abi.encode(q.paymentId, q.resultHash, commitment, urlHash))
            .toEthSignedMessageHash();

        address recovered = digest.recover(sig);
        return recovered == q.attestor && registeredAttestors[recovered];
    }

    function _decode(bytes calldata payload)
        internal
        pure
        returns (bool ok, bytes32 commitment, bytes32 urlHash, bytes memory sig)
    {
        if (payload.length < 130) return (false, 0, 0, "");
        commitment = bytes32(payload[1:33]);
        urlHash    = bytes32(payload[33:65]);
        sig        = payload[65:130];
        ok         = true;
    }
}
