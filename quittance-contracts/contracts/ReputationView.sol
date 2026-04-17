// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./QuittanceRegistry.sol";
import "./Escrow.sol";
import "./Bond.sol";

/// @notice Pure read-only contract that derives per-seller reputation metrics
///         from on-chain state in QuittanceRegistry, Escrow, and Bond.
///         No storage of its own — all data comes from the other contracts.
contract ReputationView {
    QuittanceRegistry public immutable registry;
    Escrow public immutable escrow;
    Bond public immutable bond;

    /// @notice Bronze < 80% success or < 10 deliveries.
    ///         Silver >= 80% success and >= 10 deliveries.
    ///         Gold   >= 95% success and >= 50 deliveries.
    uint8 public constant TIER_BRONZE = 0;
    uint8 public constant TIER_SILVER = 1;
    uint8 public constant TIER_GOLD   = 2;

    constructor(address _registry, address _escrow, address _bond) {
        require(_registry != address(0) && _escrow != address(0) && _bond != address(0), "Rep: zero address");
        registry = QuittanceRegistry(_registry);
        escrow   = Escrow(_escrow);
        bond     = Bond(_bond);
    }

    /// @notice Success rate in basis points (10000 = 100%).
    ///         Returns 10000 if seller has never had a transaction.
    function successRate(address seller) external view returns (uint256 bps) {
        uint256 success = registry.successCount(seller);
        uint256 failed  = escrow.failedCount(seller);
        uint256 total   = success + failed;
        if (total == 0) return 10_000;
        return (success * 10_000) / total;
    }

    /// @notice Total USDC volume settled (in token base units).
    function volumeSettled(address seller) external view returns (uint256) {
        return registry.totalVolume(seller);
    }

    /// @notice Total amount slashed from this seller's bond (in token base units).
    function slashedTotal(address seller) external view returns (uint256) {
        return bond.totalSlashed(seller);
    }

    /// @notice Current active bond balance.
    function bondBalance(address seller) external view returns (uint256) {
        return bond.bonds(seller);
    }

    /// @notice Derived tier: BRONZE (0), SILVER (1), GOLD (2).
    function tier(address seller) external view returns (uint8) {
        uint256 success = registry.successCount(seller);
        uint256 failed  = escrow.failedCount(seller);
        uint256 total   = success + failed;
        if (total == 0) return TIER_BRONZE;

        uint256 bps = (success * 10_000) / total;
        if (bps >= 9_500 && total >= 50) return TIER_GOLD;
        if (bps >= 8_000 && total >= 10) return TIER_SILVER;
        return TIER_BRONZE;
    }

    /// @notice Convenience: all metrics in one call.
    function summary(address seller)
        external
        view
        returns (
            uint256 successRateBps,
            uint256 settled,
            uint256 slashed,
            uint256 activeBond,
            uint8   sellerTier
        )
    {
        uint256 success = registry.successCount(seller);
        uint256 failed  = escrow.failedCount(seller);
        uint256 total   = success + failed;

        successRateBps = total == 0 ? 10_000 : (success * 10_000) / total;
        settled        = registry.totalVolume(seller);
        slashed        = bond.totalSlashed(seller);
        activeBond     = bond.bonds(seller);

        if (successRateBps >= 9_500 && total >= 50) {
            sellerTier = TIER_GOLD;
        } else if (successRateBps >= 8_000 && total >= 10) {
            sellerTier = TIER_SILVER;
        } else {
            sellerTier = TIER_BRONZE;
        }
    }
}
