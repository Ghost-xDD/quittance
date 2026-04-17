// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../types/QuittanceTypes.sol";

/// @notice All proof adapters must implement this interface.
interface IProofAdapter {
    /// @notice Verifies the proof encoded in `q.proofPayload`.
    /// @return True if the proof is valid for the given quittance.
    function verify(Quittance calldata q) external view returns (bool);
}
