/**
 * lib/aa.ts — Kite AA (ERC-4337) Passport helpers
 *
 * Wraps gokite-aa-sdk to give us:
 *  - Deterministic AA wallet addresses (salt = 0n always)
 *  - A ready-made signFn from an ethers.Wallet
 *  - send + poll helpers that surface clear errors
 *
 * Paymaster note: the gokite USDC token-paymaster collects gas fees from the
 * sender's AA in USDC during postOp.  It requires the sender AA to have
 * approved the paymaster before postOp runs.  Following the SDK's own
 * addApproveOperation pattern, every UserOp we build automatically prepends
 *   USDC.approve(paymaster, 0)  +  USDC.approve(paymaster, MaxUint256)
 * so the allowance is always set before postOp executes.
 */
import { ethers } from "ethers";
import { GokiteAASDK } from "gokite-aa-sdk";

// Kite mainnet USDC token-paymaster — from gokite-aa-sdk config.
const PAYMASTER_ADDR = "0x83b66982F07247F017b7954F8a775135beE931a4";

// Fixed salt so every EOA always maps to the same AA wallet.
export const AA_SALT = 0n;

const NETWORK     = process.env.KITE_NETWORK    ?? "kite_mainnet";
const KITE_RPC    = process.env.KITE_RPC_URL    ?? "https://rpc.gokite.ai";
const BUNDLER_URL = process.env.KITE_BUNDLER_URL ?? "https://bundler-service.prod.gokite.ai/rpc/";

export function makeSDK(): GokiteAASDK {
  return new GokiteAASDK(NETWORK, KITE_RPC, BUNDLER_URL);
}

/** Derive the deterministic AA (smart-account) address for a given EOA. */
export function aaAddress(sdk: GokiteAASDK, eoa: string): string {
  return sdk.getAccountAddress(eoa, AA_SALT);
}

/**
 * Build the signFn expected by sdk.sendUserOperation.
 * The EntryPoint passes the userOpHash (bytes32); we sign it with EIP-191.
 */
export function makeSignFn(wallet: ethers.Wallet) {
  return (userOpHash: string) => wallet.signMessage(ethers.getBytes(userOpHash));
}

export interface SendResult {
  userOpHash: string;
  txHash: string;
  blockNumber: number;
}

/**
 * Send a single contract call from an AA wallet and wait for confirmation.
 * Uses the Kite bundler + USDC token-paymaster (gasless to the owner).
 * Automatically prepends paymaster approve calls so postOp can collect fees.
 */
export async function aaSend(
  sdk: GokiteAASDK,
  ownerWallet: ethers.Wallet,
  target: string,
  callData: string,
  value = 0n,
): Promise<SendResult> {
  const signFn = makeSignFn(ownerWallet);
  const usdcAddr = process.env.USDC_ADDRESS!;
  const approve0   = encodeCall("function approve(address,uint256) returns (bool)", [PAYMASTER_ADDR, 0n]);
  const approveMax = encodeCall("function approve(address,uint256) returns (bool)", [PAYMASTER_ADDR, ethers.MaxUint256]);

  const userOpHash = await sdk.sendUserOperation(
    ownerWallet.address,
    {
      targets:   [usdcAddr, usdcAddr, target],
      values:    [0n, 0n, value],
      callDatas: [approve0, approveMax, callData],
    },
    signFn,
    AA_SALT,
  );
  const status = await sdk.pollUserOperationStatus(userOpHash, {
    interval: 2000,
    timeout:  90_000,
    maxRetries: 45,
  });
  if (status.status !== "success") {
    throw new Error(`UserOp ${userOpHash} failed (${status.status}): ${status.reason ?? "unknown"}`);
  }
  return {
    userOpHash,
    txHash:      status.transactionHash!,
    blockNumber: status.blockNumber!,
  };
}

/**
 * Send a batch of contract calls atomically from one AA wallet.
 * Also prepends paymaster approve calls so postOp can collect fees.
 */
export async function aaBatch(
  sdk: GokiteAASDK,
  ownerWallet: ethers.Wallet,
  calls: Array<{ target: string; callData: string; value?: bigint }>,
): Promise<SendResult> {
  const signFn = makeSignFn(ownerWallet);
  const usdcAddr = process.env.USDC_ADDRESS!;
  const approve0   = encodeCall("function approve(address,uint256) returns (bool)", [PAYMASTER_ADDR, 0n]);
  const approveMax = encodeCall("function approve(address,uint256) returns (bool)", [PAYMASTER_ADDR, ethers.MaxUint256]);

  const userOpHash = await sdk.sendUserOperation(
    ownerWallet.address,
    {
      targets:   [usdcAddr, usdcAddr, ...calls.map((c) => c.target)],
      callDatas: [approve0, approveMax, ...calls.map((c) => c.callData)],
      values:    [0n, 0n, ...calls.map((c) => c.value ?? 0n)],
    },
    signFn,
    AA_SALT,
  );
  const status = await sdk.pollUserOperationStatus(userOpHash, {
    interval: 2000,
    timeout:  90_000,
    maxRetries: 45,
  });
  if (status.status !== "success") {
    throw new Error(`Batch UserOp ${userOpHash} failed (${status.status}): ${status.reason ?? "unknown"}`);
  }
  return {
    userOpHash,
    txHash:      status.transactionHash!,
    blockNumber: status.blockNumber!,
  };
}

/** Encode a function call using a minimal ABI fragment. */
export function encodeCall(fragment: string, args: unknown[]): string {
  const iface = new ethers.Interface([fragment]);
  const name  = fragment.match(/function\s+(\w+)/)?.[1];
  if (!name) throw new Error(`Cannot parse function name from: ${fragment}`);
  return iface.encodeFunctionData(name, args);
}
