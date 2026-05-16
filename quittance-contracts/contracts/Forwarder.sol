// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./Escrow.sol";
import "./types/QuittanceTypes.sol";

/// @notice EIP-712 meta-transaction forwarder.
///
///         Enables buyer and seller agents to interact with the Quittance
///         protocol without holding native KITE gas. The forwarder:
///
///           1. Verifies an EIP-712 typed message signed by the agent's Passport.
///           2. Executes the requested protocol action (openEscrow / postQuittance / refund).
///           3. Reimburses the relayer in settlement token from the agent's gasFeeBudget.
///
///         Two typed messages are supported:
///
///           ForwardOpenEscrow — signed by buyer, opens an escrow.
///           ForwardRefund     — signed by buyer, claims a refund after deadline.
///
///         PostQuittance is submitted directly by the seller (or via the SDK's
///         relayer endpoint); the seller has the Passport key and can sign tx.
///
///         Gas reimbursement (v0 simplified model):
///           The gasFeeBudget included in ForwardOpenEscrow is held in Escrow.
///           On settle/refund, a flat relayerFee (set by owner) is deducted from
///           the gasFeeBudget and transferred to tx.origin (the relayer's EOA).
///           Unused budget refunds to buyer. No oracle rate needed in v0.
///
///         Replay protection: every ForwardOpenEscrow nonce is consumed by
///         Escrow.nextNonce(); ForwardRefund is replayable only once (Escrow
///         enforces idempotency on refund).
///
///         Operator can pause the forwarder in an emergency (sets `paused`).
contract Forwarder is Ownable, EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ─── Typed message type hashes ─────────────────────────────────────────

    bytes32 public constant FORWARD_OPEN_ESCROW_TYPEHASH = keccak256(
        "ForwardOpenEscrow(address buyerPassport,address sellerPassport,bytes32 requestHash,uint256 amount,uint256 gasFeeBudget,uint64 deadline,uint8 proofType,uint8 minBondTier,uint64 nonce)"
    );

    bytes32 public constant FORWARD_REFUND_TYPEHASH = keccak256(
        "ForwardRefund(bytes32 paymentId,address buyerPassport)"
    );

    // ─── State ─────────────────────────────────────────────────────────────

    Escrow  public immutable escrow;
    IERC20  public immutable token;

    /// @notice Flat relayer fee per meta-tx, in token base units.
    ///         Operator sets this to approximately cover gas costs.
    uint256 public relayerFee;

    bool    public paused;

    // ─── Events ────────────────────────────────────────────────────────────

    event EscrowForwarded(bytes32 indexed paymentId, address indexed buyer, address indexed relayer);
    event RefundForwarded(bytes32 indexed paymentId, address indexed buyer, address indexed relayer);
    event RelayerFeeUpdated(uint256 oldFee, uint256 newFee);
    event Paused(bool state);

    // ─── Structs ───────────────────────────────────────────────────────────

    struct ForwardOpenEscrowParams {
        address buyerPassport;
        address sellerPassport;
        bytes32 requestHash;
        uint256 amount;
        uint256 gasFeeBudget;
        uint64  deadline;
        uint8   proofType;
        uint8   minBondTier;
        uint64  nonce;
    }

    struct ForwardRefundParams {
        bytes32 paymentId;
        address buyerPassport;
    }

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(address _escrow, address _token, uint256 _relayerFee)
        Ownable(msg.sender)
        EIP712("QuittanceForwarder", "1")
    {
        require(_escrow != address(0), "Forwarder: zero escrow");
        require(_token  != address(0), "Forwarder: zero token");
        escrow      = Escrow(_escrow);
        token       = IERC20(_token);
        relayerFee  = _relayerFee;
    }

    // ─── Admin ─────────────────────────────────────────────────────────────

    function setRelayerFee(uint256 fee) external onlyOwner {
        emit RelayerFeeUpdated(relayerFee, fee);
        relayerFee = fee;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    // ─── Core meta-tx: open escrow ─────────────────────────────────────────

    /// @notice Execute a gasless openEscrow on behalf of a buyer.
    ///
    ///         The buyer signs a ForwardOpenEscrow message covering all
    ///         escrow parameters. The relayer (msg.sender) submits and is
    ///         reimbursed `relayerFee` in settlement token from the
    ///         gasFeeBudget already pulled into Escrow.
    ///
    /// @param p         Escrow parameters, must match what buyer signed.
    /// @param buyerSig  EIP-712 signature from buyerPassport over p.
    function forwardOpenEscrow(
        ForwardOpenEscrowParams calldata p,
        bytes calldata buyerSig
    ) external returns (bytes32 paymentId) {
        require(!paused, "Forwarder: paused");

        // Verify buyer's EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(
            FORWARD_OPEN_ESCROW_TYPEHASH,
            p.buyerPassport,
            p.sellerPassport,
            p.requestHash,
            p.amount,
            p.gasFeeBudget,
            p.deadline,
            p.proofType,
            p.minBondTier,
            p.nonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(buyerSig);
        require(signer == p.buyerPassport, "Forwarder: invalid buyer signature");

        // Pull total amount + gasFeeBudget from buyer in one token transfer.
        // Buyer must have approved Forwarder for (amount + gasFeeBudget).
        uint256 total = p.amount + p.gasFeeBudget;
        token.safeTransferFrom(p.buyerPassport, address(this), total);

        // Approve Escrow to pull the same amount (Escrow calls transferFrom internally).
        // We give a one-time allowance per open call.
        token.forceApprove(address(escrow), total);

        // Build paymentId (mirrors Escrow's derivation using the nonce)
        paymentId = keccak256(abi.encode(
            p.buyerPassport,
            p.sellerPassport,
            p.amount,
            p.deadline,
            bytes32(uint256(p.nonce))
        ));

        // Open the escrow. Escrow pulls `amount` from Forwarder (via the allowance above).
        // gasFeeBudget stays in Forwarder for now and is distributed at settle/refund.
        // For v0 simplicity: Forwarder passes (amount) to Escrow, keeps gasFeeBudget.
        token.forceApprove(address(escrow), p.amount);
        escrow.openEscrow(
            paymentId,
            p.buyerPassport,
            p.sellerPassport,
            p.amount,
            p.deadline,
            ProofType(p.proofType)
        );

        // Reimburse relayer immediately from gasFeeBudget (v0: flat fee).
        uint256 fee = relayerFee > p.gasFeeBudget ? p.gasFeeBudget : relayerFee;
        if (fee > 0) {
            token.safeTransfer(tx.origin, fee);
        }
        // Refund unused gasFeeBudget to buyer.
        uint256 refundable = p.gasFeeBudget - fee;
        if (refundable > 0) {
            token.safeTransfer(p.buyerPassport, refundable);
        }

        emit EscrowForwarded(paymentId, p.buyerPassport, tx.origin);
    }

    // ─── Core meta-tx: refund ──────────────────────────────────────────────

    /// @notice Execute a gasless refund on behalf of a buyer after deadline.
    ///
    ///         The buyer signs a ForwardRefund message. The relayer submits it.
    ///         No fee is deducted (refund is a public-good action; relayer is
    ///         compensated by the slash event's protocol treasury share in v1).
    ///
    /// @param p         Refund params.
    /// @param buyerSig  EIP-712 signature from buyerPassport over p.
    function forwardRefund(
        ForwardRefundParams calldata p,
        bytes calldata buyerSig
    ) external {
        require(!paused, "Forwarder: paused");

        bytes32 structHash = keccak256(abi.encode(
            FORWARD_REFUND_TYPEHASH,
            p.paymentId,
            p.buyerPassport
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(buyerSig);
        require(signer == p.buyerPassport, "Forwarder: invalid buyer signature");

        escrow.refund(p.paymentId);
        emit RefundForwarded(p.paymentId, p.buyerPassport, tx.origin);
    }

    // ─── EIP-712 domain separator (public for SDK) ─────────────────────────

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
