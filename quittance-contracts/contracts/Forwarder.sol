// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./Escrow.sol";
import "./types/QuittanceTypes.sol";

/// @notice EIP-712 meta-transaction forwarder.
///
///         Enables buyer and seller agents to open escrows and claim refunds
///         without holding native KITE gas. The relayer submits the transaction
///         and the project KITE gas fund covers the cost.
///
///         Design (v0 simplified):
///           - The Forwarder authenticates the buyer's EIP-712 signature.
///           - The buyer approves the Escrow contract directly for `amount`.
///           - The Forwarder calls Escrow.openEscrow() which pulls from buyer.
///           - No token handling in the Forwarder itself. Gas costs paid by relayer.
///
///         This avoids the double-pull problem (Forwarder + Escrow both pulling)
///         and keeps the Forwarder stateless and funds-free.
///
///         Gas reimbursement for v0: relayer runs on a project-funded KITE wallet.
///         USDC fee-based reimbursement is a v1 upgrade tracked in the spec (§5.9.3).
///
///         Operator can pause the forwarder in an emergency.
contract Forwarder is Ownable, EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ─── Typed message type hashes ─────────────────────────────────────────

    bytes32 public constant FORWARD_OPEN_ESCROW_TYPEHASH = keccak256(
        "ForwardOpenEscrow(address buyerPassport,address sellerPassport,bytes32 requestHash,uint256 amount,uint64 deadline,uint8 proofType,uint8 minBondTier,uint64 nonce)"
    );

    bytes32 public constant FORWARD_REFUND_TYPEHASH = keccak256(
        "ForwardRefund(bytes32 paymentId,address buyerPassport)"
    );

    // ─── State ─────────────────────────────────────────────────────────────

    Escrow  public immutable escrow;

    bool    public paused;

    // ─── Events ────────────────────────────────────────────────────────────

    event EscrowForwarded(bytes32 indexed paymentId, address indexed buyer, address indexed relayer);
    event RefundForwarded(bytes32 indexed paymentId, address indexed buyer, address indexed relayer);
    event Paused(bool state);

    // ─── Structs ───────────────────────────────────────────────────────────

    struct ForwardOpenEscrowParams {
        address buyerPassport;
        address sellerPassport;
        bytes32 requestHash;
        uint256 amount;
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

    constructor(address _escrow)
        Ownable(msg.sender)
        EIP712("QuittanceForwarder", "1")
    {
        require(_escrow != address(0), "Forwarder: zero escrow");
        escrow = Escrow(_escrow);
    }

    // ─── Admin ─────────────────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    // ─── Core meta-tx: open escrow ─────────────────────────────────────────

    /// @notice Execute a gasless openEscrow on behalf of a buyer.
    ///
    ///         The buyer signs a ForwardOpenEscrow message and pre-approves
    ///         the Escrow contract directly for `amount` tokens. The Forwarder
    ///         authenticates the signature and calls Escrow.openEscrow(), which
    ///         pulls `amount` from the buyer. No funds pass through the Forwarder.
    ///
    ///         Gas is paid by the relayer (project-funded KITE wallet for v0).
    ///
    /// @param p         Escrow parameters, must match what buyer signed.
    /// @param buyerSig  EIP-712 signature from buyerPassport over p.
    function forwardOpenEscrow(
        ForwardOpenEscrowParams calldata p,
        bytes calldata buyerSig
    ) external returns (bytes32 paymentId) {
        require(!paused, "Forwarder: paused");

        bytes32 structHash = keccak256(abi.encode(
            FORWARD_OPEN_ESCROW_TYPEHASH,
            p.buyerPassport,
            p.sellerPassport,
            p.requestHash,
            p.amount,
            p.deadline,
            p.proofType,
            p.minBondTier,
            p.nonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(buyerSig);
        require(signer == p.buyerPassport, "Forwarder: invalid buyer signature");

        // paymentId derivation (must match Escrow's makePaymentId logic)
        paymentId = keccak256(abi.encode(
            p.buyerPassport,
            p.sellerPassport,
            p.amount,
            p.deadline,
            bytes32(uint256(p.nonce))
        ));

        // Buyer must have approved Escrow for at least `amount` before signing.
        // Forwarder does not handle tokens — Escrow pulls from buyer directly.
        escrow.openEscrow(
            paymentId,
            p.buyerPassport,
            p.sellerPassport,
            p.amount,
            p.deadline,
            ProofType(p.proofType)
        );

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
