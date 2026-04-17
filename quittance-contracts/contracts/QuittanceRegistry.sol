// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./types/QuittanceTypes.sol";
import "./AdapterRegistry.sol";
import "./Escrow.sol";

/// @notice Accepts and stores delivery proofs (quittances).
///         A valid quittance triggers escrow settlement.
///         Maintains per-seller success counters for ReputationView.
contract QuittanceRegistry {
    AdapterRegistry public immutable adapterRegistry;
    Escrow public immutable escrow;

    mapping(bytes32 => Quittance) private _quittances;

    /// @notice Number of successful deliveries per seller.
    mapping(address => uint256) public successCount;

    /// @notice Total USDC volume settled per seller.
    mapping(address => uint256) public totalVolume;

    event QuittancePosted(
        bytes32 indexed paymentId,
        address indexed sellerPassport,
        address indexed buyerPassport,
        ProofType proofType,
        bytes32 resultHash
    );

    constructor(address _adapterRegistry, address _escrow) {
        require(_adapterRegistry != address(0), "Registry: zero adapterRegistry");
        require(_escrow != address(0), "Registry: zero escrow");
        adapterRegistry = AdapterRegistry(_adapterRegistry);
        escrow = Escrow(_escrow);
    }

    /// @notice Post a delivery proof for a previously opened escrow.
    ///
    ///         For all proof types except TIMEOUT:
    ///           - Must be called before `q.deadline`.
    ///         For TIMEOUT:
    ///           - Must be called after `q.deadline`.
    ///           - Succeeds only if the buyer has not already claimed a refund.
    ///
    /// @param q The quittance struct. `q.deliveredAt` is ignored on input and
    ///          set to block.timestamp on storage.
    function post(Quittance calldata q) external {
        require(_quittances[q.paymentId].deliveredAt == 0, "Registry: quittance already posted");

        (
            address buyer,
            address seller,
            uint256 amount,
            uint64 deadline,
            bool settled,
            bool refunded
        ) = escrow.getEscrowRecord(q.paymentId);

        require(buyer != address(0), "Registry: no escrow for paymentId");
        require(!settled && !refunded, "Registry: escrow already resolved");
        require(q.sellerPassport == seller, "Registry: seller mismatch");
        require(q.buyerPassport == buyer, "Registry: buyer mismatch");

        if (q.proofType == ProofType.TIMEOUT) {
            require(block.timestamp > deadline, "Registry: deadline not yet passed");
        } else {
            require(block.timestamp <= deadline, "Registry: deadline passed");
        }

        require(adapterRegistry.verify(q), "Registry: proof invalid");

        Quittance storage stored = _quittances[q.paymentId];
        stored.paymentId = q.paymentId;
        stored.requestHash = q.requestHash;
        stored.resultHash = q.resultHash;
        stored.sellerPassport = q.sellerPassport;
        stored.buyerPassport = q.buyerPassport;
        stored.proofType = q.proofType;
        stored.proofPayload = q.proofPayload;
        stored.attestor = q.attestor;
        stored.deliveredAt = uint64(block.timestamp);
        stored.deadline = q.deadline;

        successCount[seller]++;
        totalVolume[seller] += amount;

        escrow.settle(q.paymentId);

        emit QuittancePosted(q.paymentId, q.sellerPassport, q.buyerPassport, q.proofType, q.resultHash);
    }

    /// @notice Returns the stored quittance for a given paymentId.
    ///         `deliveredAt == 0` means no quittance has been posted.
    function getQuittance(bytes32 paymentId) external view returns (Quittance memory) {
        return _quittances[paymentId];
    }
}
