// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../types/QuittanceTypes.sol";
import "../interfaces/IProofAdapter.sol";

/// @notice Verifies ECDSA signatures from registered off-chain attestors.
///
///         proofPayload encoding:
///           abi.encodePacked(bytes signature)  — 65 bytes (r, s, v)
///
///         The signed message is:
///           keccak256(abi.encode(paymentId, resultHash))
///           prefixed with the standard Ethereum signed message prefix.
///
///         The `q.attestor` field must match the recovered signer and be registered.
contract OracleAdapter is Ownable, IProofAdapter {
    using ECDSA for bytes32;

    mapping(address => bool) public registeredAttestors;

    event AttestorRegistered(address indexed attestor);
    event AttestorRevoked(address indexed attestor);

    constructor() Ownable(msg.sender) {}

    function registerAttestor(address attestor) external onlyOwner {
        require(attestor != address(0), "Oracle: zero address");
        registeredAttestors[attestor] = true;
        emit AttestorRegistered(attestor);
    }

    function revokeAttestor(address attestor) external onlyOwner {
        registeredAttestors[attestor] = false;
        emit AttestorRevoked(attestor);
    }

    /// @inheritdoc IProofAdapter
    function verify(Quittance calldata q) external view override returns (bool) {
        if (q.proofPayload.length != 65) return false;

        bytes32 digest = keccak256(abi.encode(q.paymentId, q.resultHash))
            .toEthSignedMessageHash();

        address recovered = digest.recover(q.proofPayload);

        return recovered == q.attestor && registeredAttestors[recovered];
    }
}
