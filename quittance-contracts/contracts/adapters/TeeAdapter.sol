// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../types/QuittanceTypes.sol";
import "../interfaces/IProofAdapter.sol";

/// @notice Tier-2 honest-mock TEE adapter.
///
///         In production, this adapter would verify a remote attestation report
///         from a TEE enclave (Phala / Marlin) that contains the model hash,
///         execution environment measurement, and result commitment.
///
///         For v0, this adapter implements the HONESTY RULE (spec §5.5.1):
///           - All proofs MUST carry MOCK_FLAG (0xFF) as proofPayload[0].
///           - proofPayload is signed by a registered project-controlled attestor.
///           - The adapter emits MockAttestation on every successful verify().
///           - The off-chain attestor calls a real Phala testnet endpoint and
///             embeds the raw attestation bytes after the MOCK_FLAG.
///
///         This means:
///           - On-chain records are unforgeable by third parties (only our key signs).
///           - On-chain records are transparently labelled as testnet mocks.
///           - A judge inspecting the contract sees MOCK_FLAG and knows exactly
///             what level of attestation is being claimed.
///
///         proofPayload encoding:
///           bytes1  MOCK_FLAG (0xFF)
///           bytes32 teeReportHash  — keccak256 of raw Phala attestation bytes
///           bytes   attestorSig    — 65-byte ECDSA sig over:
///                                    keccak256(abi.encode(paymentId, resultHash, teeReportHash))
///                                    from a registered project attestor
///
///         The `q.attestor` field must match the recovered signer and be registered.
contract TeeAdapter is Ownable, IProofAdapter {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes1 public constant MOCK_FLAG = 0xFF;

    mapping(address => bool) public registeredAttestors;

    event AttestorRegistered(address indexed attestor);
    event AttestorRevoked(address indexed attestor);

    /// @notice Emitted on every successful verification (honesty rule).
    event MockAttestation(
        bytes32 indexed paymentId,
        bytes32 teeReportHash,
        address attestor,
        string  reason
    );

    constructor() Ownable(msg.sender) {}

    function registerAttestor(address attestor) external onlyOwner {
        require(attestor != address(0), "Tee: zero address");
        registeredAttestors[attestor] = true;
        emit AttestorRegistered(attestor);
    }

    function revokeAttestor(address attestor) external onlyOwner {
        registeredAttestors[attestor] = false;
        emit AttestorRevoked(attestor);
    }

    /// @inheritdoc IProofAdapter
    /// @dev Cannot emit MockAttestation from a view function; callers observe
    ///      the flag via proofPayload[0] == MOCK_FLAG. The attestation event
    ///      is emitted by the wrapper non-view function verifyAndEmit().
    function verify(Quittance calldata q) external view override returns (bool) {
        return _verify(q);
    }

    /// @notice Non-view entry point used by the off-chain SDK to both verify
    ///         and emit the MockAttestation event in the same tx as Registry.post().
    ///         Not called by AdapterRegistry (which uses the view verify); used
    ///         by the seller's attestor process for demo transparency.
    function verifyAndEmit(Quittance calldata q) external returns (bool ok) {
        ok = _verify(q);
        if (ok) {
            (, bytes32 teeReportHash,) = _decode(q.proofPayload);
            emit MockAttestation(
                q.paymentId,
                teeReportHash,
                q.attestor,
                "Tier-2 honest mock: Phala testnet attestation embedded in payload"
            );
        }
    }

    function _verify(Quittance calldata q) internal view returns (bool) {
        if (q.proofPayload.length < 1 + 32 + 65) return false;
        if (bytes1(q.proofPayload[0]) != MOCK_FLAG)     return false;

        (bool decoded, bytes32 teeReportHash, bytes memory sig) = _decode(q.proofPayload);
        if (!decoded)              return false;
        if (sig.length != 65)     return false;

        bytes32 digest = keccak256(abi.encode(q.paymentId, q.resultHash, teeReportHash))
            .toEthSignedMessageHash();

        address recovered = digest.recover(sig);
        return recovered == q.attestor && registeredAttestors[recovered];
    }

    function _decode(bytes calldata payload)
        internal
        pure
        returns (bool ok, bytes32 teeReportHash, bytes memory sig)
    {
        if (payload.length < 1 + 32 + 65) return (false, 0, "");
        teeReportHash = bytes32(payload[1:33]);
        sig           = payload[33:98];
        ok            = true;
    }
}
