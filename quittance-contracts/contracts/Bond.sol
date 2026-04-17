// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Manages seller bonds and gas floats.
///         Slashing is permissioned to the Escrow contract.
///         Withdrawals are subject to a 7-day cooldown.
contract Bond is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    /// @notice Minimum bond required to list an endpoint (in token base units).
    ///         Set in constructor to match token decimals:
    ///         1e18 for PYUSD (testnet, 18 dec), 1e6 for USDC.e (mainnet, 6 dec).
    uint256 public immutable MIN_BOND;

    uint256 public constant COOLDOWN = 7 days;

    address public escrow;

    struct WithdrawRequest {
        uint256 amount;
        uint64 availableAt;
    }

    /// @notice Active bond balance per seller.
    mapping(address => uint256) public bonds;

    /// @notice USDC float for paying bundler/relayer fees (separate from bond).
    mapping(address => uint256) public gasFloat;

    mapping(address => WithdrawRequest) public withdrawRequests;

    /// @notice Lifetime slashed amount per seller (for reputation).
    mapping(address => uint256) public totalSlashed;

    event Deposited(address indexed seller, uint256 amount);
    event WithdrawRequested(address indexed seller, uint256 amount, uint64 availableAt);
    event Withdrawn(address indexed seller, uint256 amount);
    event Slashed(address indexed seller, uint256 requested, uint256 actual);
    event GasFloatToppedUp(address indexed seller, uint256 amount);
    event GasFloatConsumed(address indexed seller, uint256 amount);
    event EscrowSet(address escrow);

    constructor(address _token, uint256 _minBond) Ownable(msg.sender) {
        require(_token != address(0), "Bond: zero token");
        token = IERC20(_token);
        MIN_BOND = _minBond;
    }

    /// @notice One-time setter called by the deploy script after Escrow is deployed.
    function setEscrow(address _escrow) external onlyOwner {
        require(escrow == address(0), "Bond: escrow already set");
        require(_escrow != address(0), "Bond: zero escrow");
        escrow = _escrow;
        emit EscrowSet(_escrow);
    }

    modifier onlyEscrow() {
        require(msg.sender == escrow, "Bond: only escrow");
        _;
    }

    // ─── Seller actions ───────────────────────────────────────────────────────

    /// @notice Stake tokens as a bond. Caller must have approved this contract.
    function deposit(uint256 amount) external {
        require(amount > 0, "Bond: zero amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        bonds[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Initiate a withdrawal. Funds are locked for COOLDOWN seconds.
    function requestWithdraw(uint256 amount) external {
        require(amount > 0, "Bond: zero amount");
        require(bonds[msg.sender] >= amount, "Bond: insufficient bond");
        require(withdrawRequests[msg.sender].amount == 0, "Bond: pending request");

        bonds[msg.sender] -= amount;
        uint64 availableAt = uint64(block.timestamp + COOLDOWN);
        withdrawRequests[msg.sender] = WithdrawRequest(amount, availableAt);
        emit WithdrawRequested(msg.sender, amount, availableAt);
    }

    /// @notice Complete a withdrawal after the cooldown period.
    function withdraw() external {
        WithdrawRequest memory req = withdrawRequests[msg.sender];
        require(req.amount > 0, "Bond: no pending request");
        require(block.timestamp >= req.availableAt, "Bond: cooldown active");

        delete withdrawRequests[msg.sender];
        token.safeTransfer(msg.sender, req.amount);
        emit Withdrawn(msg.sender, req.amount);
    }

    /// @notice Top up the gas float used to pay bundler fees.
    function topUpGasFloat(uint256 amount) external {
        require(amount > 0, "Bond: zero amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        gasFloat[msg.sender] += amount;
        emit GasFloatToppedUp(msg.sender, amount);
    }

    // ─── Escrow-permissioned ──────────────────────────────────────────────────

    /// @notice Slash a seller's bond. Called by Escrow on refund.
    ///         Slashed funds go to the owner (protocol treasury) for v1.
    function slash(address seller, uint256 amount) external onlyEscrow {
        uint256 slashable = bonds[seller];
        uint256 actual = amount > slashable ? slashable : amount;
        if (actual == 0) return;

        bonds[seller] -= actual;
        totalSlashed[seller] += actual;
        token.safeTransfer(owner(), actual);
        emit Slashed(seller, amount, actual);
    }

    /// @notice Deduct from a seller's gas float. Called by Escrow when covering bundler fees.
    function consumeGasFloat(address seller, uint256 amount) external onlyEscrow {
        require(gasFloat[seller] >= amount, "Bond: insufficient gas float");
        gasFloat[seller] -= amount;
        emit GasFloatConsumed(seller, amount);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /// @notice Compute the minimum bond required for a given price and multiplier.
    function minBondRequired(uint256 price, uint256 multiplier) external view returns (uint256) {
        uint256 computed = price * multiplier;
        return computed > MIN_BOND ? computed : MIN_BOND;
    }

    /// @notice Returns true if the seller's bond meets the minimum required for `price`.
    function isSufficientlyBonded(address seller, uint256 price) external view returns (bool) {
        return bonds[seller] >= (price > MIN_BOND ? price : MIN_BOND);
    }
}
