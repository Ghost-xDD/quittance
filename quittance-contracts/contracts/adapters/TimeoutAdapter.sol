// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../types/QuittanceTypes.sol";
import "../interfaces/IProofAdapter.sol";
import "../Escrow.sol";

/// @notice Optimistic fallback adapter.
///         Allows a seller to claim payment if the deadline has passed and
///         the buyer has not triggered a refund.
///
///         Usage: seller posts a TIMEOUT quittance AFTER `q.deadline`.
///         QuittanceRegistry already enforces `block.timestamp > deadline`
///         for TIMEOUT proof types, so this adapter only needs to check
///         that the escrow hasn't already been refunded.
///
///         proofPayload: empty (0 bytes) — no cryptographic proof required.
contract TimeoutAdapter is IProofAdapter {
    Escrow public immutable escrow;

    constructor(address _escrow) {
        require(_escrow != address(0), "Timeout: zero escrow");
        escrow = Escrow(_escrow);
    }

    /// @inheritdoc IProofAdapter
    function verify(Quittance calldata q) external view override returns (bool) {
        (, , , , bool settled, bool refunded) = escrow.getEscrowRecord(q.paymentId);
        // passes if not yet resolved (buyer hasn't claimed refund)
        return !settled && !refunded;
    }
}
