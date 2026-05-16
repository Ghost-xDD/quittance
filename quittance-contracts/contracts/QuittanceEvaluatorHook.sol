// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Escrow.sol";
import "./QuittanceRegistry.sol";

/// @notice ERC-8183-compatible evaluator hook for ACP marketplaces.
///
///         Any ACP (Agentic Commerce Protocol) marketplace that implements the
///         IACPHook interface can register this contract as its evaluator to
///         inherit Quittance's full escrow, slashing, and proof-of-delivery
///         stack without writing any contracts of their own.
///
///         Lifecycle mapping (ERC-8183 → Quittance):
///           fund(jobId)          → opens an Escrow for this job
///           submit(jobId, proof) → posts a Quittance via QuittanceRegistry
///           complete(jobId)      → returns true iff a valid Quittance exists
///           reject(jobId)        → calls Escrow.refund(), slashing seller bond
///
///         This contract stores a jobId → paymentId mapping. All enforcement
///         (funds, slash, timeout) lives in Escrow / Bond / QuittanceRegistry.
///
///         Integration for an ERC-8183 marketplace:
///
///           QuittanceEvaluatorHook hook = new QuittanceEvaluatorHook(escrow, registry);
///           marketplace.registerHook(address(hook)); // one config line
///
///         After registration, every job in that marketplace gets:
///           - On-chain escrow linked to buyer's x402 payment
///           - Proof verification by the seller's chosen adapter
///           - Automatic slash if the seller fails to deliver before deadline
///
/// @dev The IACPHook interface is defined inline here because ERC-8183 is a
///      draft spec and no canonical package exists yet. Once standardised,
///      this contract will import from the official ERC-8183 package.
interface IACPHook {
    function fund(uint256 jobId, bytes calldata meta) external returns (bytes32 paymentId);
    function submit(uint256 jobId, bytes calldata proofPayload) external;
    function reject(uint256 jobId, string calldata reason) external;
    function complete(uint256 jobId) external view returns (bool);
}

contract QuittanceEvaluatorHook is IACPHook, Ownable {

    // ─── State ─────────────────────────────────────────────────────────────

    Escrow            public immutable escrow;
    QuittanceRegistry public immutable registry;

    /// @notice Maps ACP jobId to the Quittance paymentId opened for it.
    mapping(uint256 => bytes32) public jobPaymentId;

    /// @notice Marketplace contract addresses that are permitted to call this hook.
    mapping(address => bool) public permittedMarketplaces;

    // ─── Events ────────────────────────────────────────────────────────────

    event JobFunded(uint256 indexed jobId, bytes32 indexed paymentId);
    event JobSubmitted(uint256 indexed jobId, bytes32 indexed paymentId);
    event JobCompleted(uint256 indexed jobId, bytes32 indexed paymentId);
    event JobRejected(uint256 indexed jobId, bytes32 indexed paymentId, string reason);
    event MarketplacePermitted(address indexed marketplace, bool permitted);

    // ─── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyPermitted() {
        require(permittedMarketplaces[msg.sender], "Hook: caller not permitted marketplace");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(address _escrow, address _registry) Ownable(msg.sender) {
        require(_escrow   != address(0), "Hook: zero escrow");
        require(_registry != address(0), "Hook: zero registry");
        escrow   = Escrow(_escrow);
        registry = QuittanceRegistry(_registry);
    }

    // ─── Admin ─────────────────────────────────────────────────────────────

    /// @notice Grant or revoke permission for a marketplace to call this hook.
    function setMarketplace(address marketplace, bool permitted) external onlyOwner {
        permittedMarketplaces[marketplace] = permitted;
        emit MarketplacePermitted(marketplace, permitted);
    }

    // ─── IACPHook ──────────────────────────────────────────────────────────

    /// @notice Called by the marketplace when a job is funded.
    ///
    ///         meta encoding (abi-encoded):
    ///           address buyer
    ///           address seller
    ///           uint256 amount
    ///           uint64  deadline
    ///           uint8   proofType
    ///           bytes32 requestHash
    ///           bytes32 paymentId   ← the paymentId already opened in Escrow
    ///                                  by the buyer's x402 payment
    ///
    ///         The marketplace is responsible for opening the Escrow (via the
    ///         buyer's x402 payment flow) before calling fund(). This hook
    ///         records the association between jobId and paymentId.
    ///
    /// @return paymentId The Quittance paymentId bound to this job.
    function fund(uint256 jobId, bytes calldata meta)
        external
        override
        onlyPermitted
        returns (bytes32 paymentId)
    {
        require(jobPaymentId[jobId] == bytes32(0), "Hook: job already funded");

        (
            address buyer,
            address seller,
            uint256 amount,
            uint64  deadline,
            uint8   proofType,
            bytes32 requestHash,
            bytes32 _paymentId
        ) = abi.decode(meta, (address, address, uint256, uint64, uint8, bytes32, bytes32));

        // Validate the escrow actually exists and matches the declared params.
        (
            address escrowBuyer,
            address escrowSeller,
            uint256 escrowAmount,
            uint64  escrowDeadline,
            bool    settled,
            bool    refunded
        ) = escrow.getEscrowRecord(_paymentId);

        require(escrowBuyer  == buyer,    "Hook: escrow buyer mismatch");
        require(escrowSeller == seller,   "Hook: escrow seller mismatch");
        require(escrowAmount == amount,   "Hook: escrow amount mismatch");
        require(escrowDeadline == deadline, "Hook: escrow deadline mismatch");
        require(!settled && !refunded,    "Hook: escrow already resolved");

        // Suppress unused variable warnings; values validated above.
        (proofType, requestHash);

        jobPaymentId[jobId] = _paymentId;
        paymentId = _paymentId;

        emit JobFunded(jobId, paymentId);
    }

    /// @notice Called by the marketplace when the seller submits proof of delivery.
    ///
    ///         proofPayload is forwarded verbatim to QuittanceRegistry.post().
    ///         The marketplace must pass the full Quittance struct encoded as:
    ///           abi.encode(Quittance q)
    ///
    ///         On success, Registry triggers Escrow.settle() and the job is done.
    function submit(uint256 jobId, bytes calldata proofPayload)
        external
        override
        onlyPermitted
    {
        bytes32 paymentId = jobPaymentId[jobId];
        require(paymentId != bytes32(0), "Hook: job not funded");

        Quittance memory q = abi.decode(proofPayload, (Quittance));
        require(q.paymentId == paymentId, "Hook: paymentId mismatch");

        registry.post(q);
        emit JobSubmitted(jobId, paymentId);
    }

    /// @notice Called by the marketplace when the job deadline expires without delivery.
    ///         Triggers Escrow.refund(), which slashes the seller's bond.
    ///
    /// @param reason  Human-readable reason string (logged in event).
    function reject(uint256 jobId, string calldata reason)
        external
        override
        onlyPermitted
    {
        bytes32 paymentId = jobPaymentId[jobId];
        require(paymentId != bytes32(0), "Hook: job not funded");

        escrow.refund(paymentId);
        emit JobRejected(jobId, paymentId, reason);
    }

    /// @notice Returns true iff a valid Quittance has been posted for this job.
    ///         The marketplace polls this to determine job completion.
    function complete(uint256 jobId)
        external
        view
        override
        returns (bool)
    {
        bytes32 paymentId = jobPaymentId[jobId];
        if (paymentId == bytes32(0)) return false;

        Quittance memory q = registry.getQuittance(paymentId);
        return q.deliveredAt > 0;
    }
}
