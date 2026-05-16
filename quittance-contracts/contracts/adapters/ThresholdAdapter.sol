// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../types/QuittanceTypes.sol";
import "../interfaces/IProofAdapter.sol";

/// @notice M-of-N independent attestor signature adapter.
///
///         Designed for services that need multiple independent verifiers —
///         e.g. the PriceFeed-Agent's 3-of-5 threshold scheme.
///
///         proofPayload encoding:
///           abi.encode(bytes[] signatures)
///           where each signature is a 65-byte ECDSA sig over:
///             keccak256(abi.encode(paymentId, resultHash)).toEthSignedMessageHash()
///
///         Verification:
///           1. Decode the signatures array.
///           2. Recover the signer of each signature.
///           3. Check that each signer is a registered attestor (no duplicates).
///           4. Require that the count of valid distinct attestor signatures >= threshold.
///
///         The contract owner registers/revokes attestors and sets the M threshold.
///         New attestors can be added without redeploying.
contract ThresholdAdapter is Ownable, IProofAdapter {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice Registered attestor addresses.
    mapping(address => bool) public isAttestor;

    /// @notice Ordered list of all registered attestors (for enumeration).
    address[] public attestorList;

    /// @notice Minimum number of valid attestor signatures required.
    uint8 public threshold;

    event AttestorAdded(address indexed attestor);
    event AttestorRemoved(address indexed attestor);
    event ThresholdUpdated(uint8 oldThreshold, uint8 newThreshold);

    constructor(uint8 _threshold) Ownable(msg.sender) {
        require(_threshold > 0, "Threshold: zero threshold");
        threshold = _threshold;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function addAttestor(address attestor) external onlyOwner {
        require(attestor != address(0), "Threshold: zero address");
        require(!isAttestor[attestor], "Threshold: already registered");
        isAttestor[attestor] = true;
        attestorList.push(attestor);
        emit AttestorAdded(attestor);
    }

    function removeAttestor(address attestor) external onlyOwner {
        require(isAttestor[attestor], "Threshold: not registered");
        isAttestor[attestor] = false;
        // Remove from list (order-insensitive swap)
        for (uint256 i = 0; i < attestorList.length; i++) {
            if (attestorList[i] == attestor) {
                attestorList[i] = attestorList[attestorList.length - 1];
                attestorList.pop();
                break;
            }
        }
        emit AttestorRemoved(attestor);
    }

    function setThreshold(uint8 _threshold) external onlyOwner {
        require(_threshold > 0, "Threshold: zero threshold");
        emit ThresholdUpdated(threshold, _threshold);
        threshold = _threshold;
    }

    function attestorCount() external view returns (uint256) {
        return attestorList.length;
    }

    // ─── IProofAdapter ──────────────────────────────────────────────────────

    /// @inheritdoc IProofAdapter
    function verify(Quittance calldata q) external view override returns (bool) {
        if (q.proofPayload.length == 0) return false;

        bytes[] memory sigs = abi.decode(q.proofPayload, (bytes[]));
        if (sigs.length < threshold) return false;

        bytes32 digest = keccak256(abi.encode(q.paymentId, q.resultHash))
            .toEthSignedMessageHash();

        uint8   validCount = 0;
        // Track seen signers to prevent duplicate signatures from the same attestor.
        // Max attestors is bounded by the registered list length (≤ 255 in practice).
        address[] memory seen = new address[](sigs.length);
        uint256 seenCount = 0;

        for (uint256 i = 0; i < sigs.length; i++) {
            if (sigs[i].length != 65) continue;

            address signer = digest.recover(sigs[i]);
            if (!isAttestor[signer]) continue;

            // Duplicate check
            bool duplicate = false;
            for (uint256 j = 0; j < seenCount; j++) {
                if (seen[j] == signer) { duplicate = true; break; }
            }
            if (duplicate) continue;

            seen[seenCount++] = signer;
            validCount++;
            if (validCount >= threshold) return true;
        }

        return false;
    }
}
