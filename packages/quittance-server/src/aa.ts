import { ethers } from "ethers";
import { GokiteAASDK } from "gokite-aa-sdk";

const PAYMASTER_ADDR = "0x83b66982F07247F017b7954F8a775135beE931a4";
export const AA_SALT = 0n;

export function makeSDK(): GokiteAASDK {
  const network    = process.env.KITE_NETWORK     ?? "kite_mainnet";
  const rpc        = process.env.KITE_RPC_URL     ?? "https://rpc.gokite.ai";
  const bundlerUrl = process.env.KITE_BUNDLER_URL ?? "https://bundler-service.prod.gokite.ai/rpc/";
  return new GokiteAASDK(network, rpc, bundlerUrl);
}

export function aaAddress(sdk: GokiteAASDK, eoa: string): string {
  return sdk.getAccountAddress(eoa, AA_SALT);
}

export interface SendResult {
  userOpHash:  string;
  txHash:      string;
  blockNumber: number;
}

/** Encode a contract call from a human-readable ABI fragment. */
export function encodeCall(fragment: string, args: unknown[]): string {
  const iface = new ethers.Interface([fragment]);
  const name  = fragment.match(/function\s+(\w+)/)?.[1];
  if (!name) throw new Error(`Cannot parse function name from: ${fragment}`);
  return iface.encodeFunctionData(name, args);
}

/**
 * Send a single call from an AA wallet.
 * Prepends paymaster approve ops so the USDC token-paymaster can collect gas.
 */
export async function aaSend(
  sdk:         GokiteAASDK,
  ownerWallet: ethers.Wallet,
  target:      string,
  callData:    string,
  value = 0n,
): Promise<SendResult> {
  const signFn    = (h: string) => ownerWallet.signMessage(ethers.getBytes(h));
  const usdcAddr  = process.env.USDC_ADDRESS!;
  const approve0  = encodeCall("function approve(address,uint256) returns (bool)", [PAYMASTER_ADDR, 0n]);
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
    interval: 2000, timeout: 90_000, maxRetries: 45,
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
