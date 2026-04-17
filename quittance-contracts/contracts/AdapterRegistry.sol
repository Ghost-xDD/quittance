// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./types/QuittanceTypes.sol";
import "./interfaces/IProofAdapter.sol";

/// @notice Maps ProofType enum values to their verifier contract addresses.
///         Owner-gated for v1; permissionless registration is a v2 candidate.
contract AdapterRegistry is Ownable {
    mapping(ProofType => address) public adapters;

    event AdapterRegistered(ProofType indexed proofType, address indexed adapter);
    event AdapterRemoved(ProofType indexed proofType);

    constructor() Ownable(msg.sender) {}

    /// @notice Register or replace the adapter for a given proof type.
    function register(ProofType proofType, address adapter) external onlyOwner {
        require(adapter != address(0), "AdapterRegistry: zero address");
        adapters[proofType] = adapter;
        emit AdapterRegistered(proofType, adapter);
    }

    function remove(ProofType proofType) external onlyOwner {
        delete adapters[proofType];
        emit AdapterRemoved(proofType);
    }

    /// @notice Delegates verification to the registered adapter for `q.proofType`.
    function verify(Quittance calldata q) external view returns (bool) {
        address adapter = adapters[q.proofType];
        require(adapter != address(0), "AdapterRegistry: no adapter registered");
        return IProofAdapter(adapter).verify(q);
    }
}
