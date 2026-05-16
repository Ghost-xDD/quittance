// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./types/QuittanceTypes.sol";
import "./Bond.sol";

/// @notice Holds buyer funds between x402 payment and delivery proof.
///         Funds are released on a valid quittance or returned to buyer after deadline.
///
///         Flow:
///           1. Buyer pre-approves this contract on the token.
///           2. Seller middleware calls openEscrow() after verifying x402 authorization.
///           3. QuittanceRegistry calls settle() when a valid quittance is posted.
///           4. Buyer calls refund() after deadline if no quittance arrived.
contract Escrow is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    Bond public immutable bond;

    /// @notice Set once after QuittanceRegistry is deployed.
    address public registry;

    struct EscrowRecord {
        address buyer;
        address seller;
        uint256 amount;
        uint64 deadline;
        ProofType proofType;
        bool settled;
        bool refunded;
    }

    mapping(bytes32 => EscrowRecord) public escrows;

    /// @notice Per-seller count of failed deliveries (for reputation).
    mapping(address => uint256) public failedCount;

    event EscrowOpened(
        bytes32 indexed paymentId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint64 deadline,
        ProofType proofType
    );
    event EscrowSettled(bytes32 indexed paymentId, address indexed seller, uint256 amount);
    event EscrowRefunded(bytes32 indexed paymentId, address indexed buyer, uint256 amount, uint256 slashed);
    event RegistrySet(address registry);

    constructor(address _token, address _bond) Ownable(msg.sender) {
        require(_token != address(0), "Escrow: zero token");
        require(_bond != address(0), "Escrow: zero bond");
        token = IERC20(_token);
        bond = Bond(_bond);
    }

    /// @notice One-time setter called by the deploy script after QuittanceRegistry is deployed.
    function setRegistry(address _registry) external onlyOwner {
        require(registry == address(0), "Escrow: registry already set");
        require(_registry != address(0), "Escrow: zero registry");
        registry = _registry;
        emit RegistrySet(_registry);
    }

    modifier onlyRegistry() {
        require(msg.sender == registry, "Escrow: only registry");
        _;
    }

    // ─── Core actions ─────────────────────────────────────────────────────────

    /// @notice Open an escrow for an x402 payment.
    ///         Caller is typically the seller's SDK middleware.
    ///         Buyer must have pre-approved this contract for `amount` tokens.
    ///
    /// @param paymentId  keccak256(buyer, seller, amount, deadline, authNonce)
    /// @param buyer      Buyer's AA wallet address.
    /// @param seller     Seller's AA wallet address.
    /// @param amount     Token amount (in token base units).
    /// @param deadline   Unix timestamp by which a quittance must be posted.
    /// @param proofType  Expected proof modality.
    function openEscrow(
        bytes32 paymentId,
        address buyer,
        address seller,
        uint256 amount,
        uint64 deadline,
        ProofType proofType
    ) external {
        require(escrows[paymentId].buyer == address(0), "Escrow: paymentId already used");
        require(deadline > block.timestamp, "Escrow: deadline in past");
        require(amount > 0, "Escrow: zero amount");
        require(
            bond.isSufficientlyBonded(seller, amount),
            "Escrow: seller underbonded"
        );

        token.safeTransferFrom(buyer, address(this), amount);

        escrows[paymentId] = EscrowRecord({
            buyer: buyer,
            seller: seller,
            amount: amount,
            deadline: deadline,
            proofType: proofType,
            settled: false,
            refunded: false
        });

        emit EscrowOpened(paymentId, buyer, seller, amount, deadline, proofType);
    }

    /// @notice Release funds to seller. Called by QuittanceRegistry after proof verification.
    function settle(bytes32 paymentId) external onlyRegistry {
        EscrowRecord storage rec = escrows[paymentId];
        require(rec.buyer != address(0), "Escrow: not found");
        require(!rec.settled && !rec.refunded, "Escrow: already resolved");

        rec.settled = true;
        token.safeTransfer(rec.seller, rec.amount);
        emit EscrowSettled(paymentId, rec.seller, rec.amount);
    }

    /// @notice Return funds to buyer and slash seller's bond.
    ///         Permissionless: callable by anyone after the delivery deadline has passed.
    ///         The buyer is always the one who receives the refund regardless of caller.
    function refund(bytes32 paymentId) external {
        EscrowRecord storage rec = escrows[paymentId];
        require(rec.buyer != address(0), "Escrow: not found");
        require(!rec.settled && !rec.refunded, "Escrow: already resolved");
        require(block.timestamp > rec.deadline, "Escrow: deadline not passed");

        rec.refunded = true;
        failedCount[rec.seller]++;

        token.safeTransfer(rec.buyer, rec.amount);
        uint256 slashAmount = rec.amount; // 100% of payment value, capped by bond balance
        bond.slash(rec.seller, slashAmount);

        emit EscrowRefunded(paymentId, rec.buyer, rec.amount, slashAmount);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /// @notice Returns individual fields for a given paymentId.
    ///         Used by QuittanceRegistry to validate without importing EscrowRecord.
    function getEscrowRecord(bytes32 paymentId)
        external
        view
        returns (
            address buyer,
            address seller,
            uint256 amount,
            uint64 deadline,
            bool settled,
            bool refunded
        )
    {
        EscrowRecord storage rec = escrows[paymentId];
        return (rec.buyer, rec.seller, rec.amount, rec.deadline, rec.settled, rec.refunded);
    }
}
