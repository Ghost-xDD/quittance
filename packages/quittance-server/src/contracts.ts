import { ethers } from "ethers";
import { ERC20_ABI, BOND_ABI, ESCROW_ABI, REGISTRY_ABI } from "./abis.js";

export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.KITE_RPC_URL ?? "https://rpc.gokite.ai",
  );
}

export function getSigner(privateKey: string, provider: ethers.JsonRpcProvider): ethers.Wallet {
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return new ethers.Wallet(key, provider);
}

export function getContracts(provider: ethers.JsonRpcProvider) {
  const token = process.env.USDC_ADDRESS ?? process.env.PYUSD_ADDRESS!;
  const c = (addr: string, abi: string[]) => new ethers.Contract(addr, abi, provider);
  return {
    usdc:     c(token,                             ERC20_ABI),
    bond:     c(process.env.BOND_ADDRESS!,         BOND_ABI),
    escrow:   c(process.env.ESCROW_ADDRESS!,       ESCROW_ABI),
    registry: c(process.env.REGISTRY_ADDRESS!,     REGISTRY_ABI),
  };
}

export function makePaymentId(
  buyer:    string,
  seller:   string,
  amount:   bigint,
  deadline: bigint,
  nonce:    Uint8Array,
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "uint64", "bytes32"],
      [buyer, seller, amount, deadline, nonce],
    ),
  );
}

export async function signOracleProof(
  signer:      ethers.Signer,
  paymentId:   string,
  resultHash:  string,
): Promise<string> {
  const messageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [paymentId, resultHash],
    ),
  );
  return signer.signMessage(ethers.getBytes(messageHash));
}

const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS ?? "6");
export function fmt(amount: bigint, decimals = TOKEN_DECIMALS): string {
  return ethers.formatUnits(amount, decimals);
}
