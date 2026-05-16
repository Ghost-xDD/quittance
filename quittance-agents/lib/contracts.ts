import { ethers } from 'ethers';

// ─── Minimal ABIs ─────────────────────────────────────────────────────────────

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

export const BOND_ABI = [
  'function bonds(address) view returns (uint256)',
  'function MIN_BOND() view returns (uint256)',
  'function gasFloat(address) view returns (uint256)',
  'function deposit(uint256 amount)',
  'function isSufficientlyBonded(address seller, uint256 price) view returns (bool)',
];

export const ESCROW_ABI = [
  'function openEscrow(bytes32 paymentId, address buyer, address seller, uint256 amount, uint64 deadline, uint8 proofType)',
  'function refund(bytes32 paymentId)',
  'function getEscrowRecord(bytes32 paymentId) view returns (address buyer, address seller, uint256 amount, uint64 deadline, bool settled, bool refunded)',
  'function failedCount(address) view returns (uint256)',
];

export const REGISTRY_ABI = [
  'function post(tuple(bytes32 paymentId, bytes32 requestHash, bytes32 resultHash, address sellerPassport, address buyerPassport, uint8 proofType, bytes proofPayload, address attestor, uint64 deliveredAt, uint64 deadline) q)',
  'function getQuittance(bytes32 paymentId) view returns (tuple(bytes32 paymentId, bytes32 requestHash, bytes32 resultHash, address sellerPassport, address buyerPassport, uint8 proofType, bytes proofPayload, address attestor, uint64 deliveredAt, uint64 deadline))',
  'function successCount(address) view returns (uint256)',
  'function totalVolume(address) view returns (uint256)',
];

export const REPUTATION_ABI = [
  'function summary(address seller) view returns (uint256 successRateBps, uint256 settled, uint256 slashed, uint256 activeBond, uint8 sellerTier)',
  'function tier(address seller) view returns (uint8)',
];

// ─── ProofType enum (matches Solidity) ───────────────────────────────────────

export const ProofType = {
  ORACLE: 0,
  TEE: 1,
  ZKTLS: 2,
  COSIGN: 3,
  THRESHOLD: 4,
  TIMEOUT: 5,
} as const;

// ─── paymentId derivation ─────────────────────────────────────────────────────

export function makePaymentId(
  buyer: string,
  seller: string,
  amount: bigint,
  deadline: bigint,
  nonce: Uint8Array,
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256', 'uint64', 'bytes32'],
      [buyer, seller, amount, deadline, nonce],
    ),
  );
}

// ─── Oracle proof signing ─────────────────────────────────────────────────────

export async function signOracleProof(
  signer: ethers.Signer,
  paymentId: string,
  resultHash: string,
): Promise<string> {
  const messageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32'],
      [paymentId, resultHash],
    ),
  );
  return signer.signMessage(ethers.getBytes(messageHash));
}

// ─── Provider + contract factory ─────────────────────────────────────────────

export function getProvider(): ethers.JsonRpcProvider {
  const url = process.env.KITE_RPC_URL ?? 'https://rpc-testnet.gokite.ai';
  return new ethers.JsonRpcProvider(url);
}

export function getSigner(
  privateKey: string,
  provider: ethers.JsonRpcProvider,
): ethers.Wallet {
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  return new ethers.Wallet(key, provider);
}

export function getContracts(provider: ethers.JsonRpcProvider | ethers.Signer) {
  const e = (addr: string, abi: string[]) =>
    new ethers.Contract(addr, abi, provider);
  return {
    pyusd: e(process.env.PYUSD_ADDRESS!, ERC20_ABI),
    bond: e(process.env.BOND_ADDRESS!, BOND_ABI),
    escrow: e(process.env.ESCROW_ADDRESS!, ESCROW_ABI),
    registry: e(process.env.REGISTRY_ADDRESS!, REGISTRY_ABI),
    reputation: e(process.env.REPUTATION_ADDRESS!, REPUTATION_ABI),
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmt(amount: bigint, decimals = 18): string {
  return ethers.formatUnits(amount, decimals);
}

export const TIER_LABEL = ['Bronze', 'Silver', 'Gold'] as const;
