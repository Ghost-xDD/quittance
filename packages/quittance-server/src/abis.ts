export const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

export const BOND_ABI = [
  "function bonds(address) view returns (uint256)",
  "function MIN_BOND() view returns (uint256)",
];

export const ESCROW_ABI = [
  "function openEscrow(bytes32 paymentId, address buyer, address seller, uint256 amount, uint64 deadline, uint8 proofType)",
  "function refund(bytes32 paymentId)",
];

export const REGISTRY_ABI = [
  `function post(tuple(
    bytes32 paymentId, bytes32 requestHash, bytes32 resultHash,
    address sellerPassport, address buyerPassport,
    uint8 proofType, bytes proofPayload, address attestor,
    uint64 deliveredAt, uint64 deadline
  ) q)`,
];

export const ProofType = {
  ORACLE:    0,
  TEE:       1,
  ZKTLS:     2,
  COSIGN:    3,
  THRESHOLD: 4,
  TIMEOUT:   5,
} as const;
