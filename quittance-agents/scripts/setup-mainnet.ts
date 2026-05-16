/**
 * setup-mainnet.ts — Bond seller and approve escrow on Kite mainnet
 *
 * 1. Sends USDC from Passport wallet to seller AA (via kpass)
 * 2. Seller AA deposits 1 USDC bond into Bond contract (gasless AA UserOp)
 * 3. Buyer AA approves Escrow to spend USDC (gasless AA UserOp)
 *
 * Usage:  npm run setup-mainnet
 */

import "dotenv/config";
import { ethers } from "ethers";
import { exec } from "child_process";
import { promisify } from "util";
import {
  getProvider, getSigner, getContracts, fmt,
} from "../lib/contracts";
import { makeSDK, aaAddress, aaSend, encodeCall, AA_SALT } from "../lib/aa";

const execAsync = promisify(exec);

const USDC_ADDR    = process.env.USDC_ADDRESS!;
const BOND_ADDR    = process.env.BOND_ADDRESS!;
const ESCROW_ADDR  = process.env.ESCROW_ADDRESS!;
const TOKEN_DEC    = parseInt(process.env.TOKEN_DECIMALS ?? "6");
const MIN_BOND     = ethers.parseUnits("1", TOKEN_DEC);   // 1 USDC
const APPROVE_AMT  = ethers.parseUnits("10", TOKEN_DEC);  // 10 USDC allowance

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag.padEnd(10)}] ${msg}`);
}

async function main() {
  const provider   = getProvider();
  const network    = await provider.getNetwork();
  log("network", `Kite Mainnet  chainId=${network.chainId}`);

  const sellerKey  = process.env.SELLER_SMS_PRO_PRIVATE_KEY!;
  const buyerKey   = process.env.BUYER_PRIVATE_KEY!;
  const sellerEOA  = getSigner(sellerKey, provider);
  const buyerEOA   = getSigner(buyerKey, provider);
  const sdk        = makeSDK();
  const sellerAA   = aaAddress(sdk, sellerEOA.address);
  const buyerAA    = aaAddress(sdk, buyerEOA.address);

  log("wallets", `Seller EOA: ${sellerEOA.address}`);
  log("wallets", `Seller AA:  ${sellerAA}`);
  log("wallets", `Buyer EOA:  ${buyerEOA.address}`);
  log("wallets", `Buyer AA:   ${buyerAA}`);

  const c = getContracts(provider);

  // ── Current state ──────────────────────────────────────────────────────────
  const [sellerAABal, sellerBond, buyerAABal, buyerAllowance] = (await Promise.all([
    c.usdc.balanceOf(sellerAA),
    c.bond.bonds(sellerAA),
    c.usdc.balanceOf(buyerAA),
    c.usdc.allowance(buyerAA, ESCROW_ADDR),
  ])) as [bigint, bigint, bigint, bigint];

  log("state", `Seller AA USDC: ${fmt(sellerAABal)}  Bond: ${fmt(sellerBond)}`);
  log("state", `Buyer  AA USDC: ${fmt(buyerAABal)}  Escrow allowance: ${fmt(buyerAllowance)}`);

  // ── Step 1: Fund seller AA via kpass if needed ─────────────────────────────
  if (sellerAABal < MIN_BOND) {
    const needed = MIN_BOND - sellerAABal;
    log("fund", `Sending ${fmt(needed)} USDC to seller AA via kpass…`);
    const { stdout } = await execAsync(
      `kpass wallet send --to ${sellerAA} --amount ${ethers.formatUnits(needed, TOKEN_DEC)} --asset USDC --output json`,
    );
    const result = JSON.parse(stdout) as { status: string; transaction_hash?: string };
    if (result.status !== "success") throw new Error(`kpass send failed: ${stdout}`);
    log("fund", `✓ tx ${result.transaction_hash}`);
    // Wait for balance to reflect
    await new Promise(r => setTimeout(r, 5000));
  }

  // ── Step 2: Bond seller AA ─────────────────────────────────────────────────
  if (sellerBond < MIN_BOND) {
    log("bond", `Approving Bond contract to pull ${fmt(MIN_BOND)} USDC…`);
    const approveCD = encodeCall(
      "function approve(address spender, uint256 amount) returns (bool)",
      [BOND_ADDR, MIN_BOND],
    );
    const appr = await aaSend(sdk, sellerEOA, USDC_ADDR, approveCD);
    log("bond", `Approve tx: ${appr.txHash}`);

    log("bond", `Depositing ${fmt(MIN_BOND)} USDC bond…`);
    const depositCD = encodeCall(
      "function deposit(uint256 amount)",
      [MIN_BOND],
    );
    const dep = await aaSend(sdk, sellerEOA, BOND_ADDR, depositCD);
    log("bond", `✓ Bond deposit tx: ${dep.txHash}  block: ${dep.blockNumber}`);
  } else {
    log("bond", `Seller already bonded: ${fmt(sellerBond)} USDC ✓`);
  }

  // ── Step 3: Fund buyer AA via kpass if needed ──────────────────────────────
  if (buyerAABal < ethers.parseUnits("0.01", TOKEN_DEC)) {
    log("fund", `Sending 0.01 USDC to buyer AA via kpass…`);
    const { stdout } = await execAsync(
      `kpass wallet send --to ${buyerAA} --amount 0.01 --asset USDC --output json`,
    );
    const result = JSON.parse(stdout) as { status: string; transaction_hash?: string };
    if (result.status !== "success") throw new Error(`kpass send failed: ${stdout}`);
    log("fund", `✓ tx ${result.transaction_hash}`);
    await new Promise(r => setTimeout(r, 5000));
  }

  // ── Step 4: Approve escrow from buyer AA ───────────────────────────────────
  if (buyerAllowance < ethers.parseUnits("0.001", TOKEN_DEC)) {
    log("approve", `Buyer AA approving Escrow to spend ${fmt(APPROVE_AMT)} USDC…`);
    const approveCD = encodeCall(
      "function approve(address spender, uint256 amount) returns (bool)",
      [ESCROW_ADDR, APPROVE_AMT],
    );
    const appr = await aaSend(sdk, buyerEOA, USDC_ADDR, approveCD);
    log("approve", `✓ Escrow approved tx: ${appr.txHash}  block: ${appr.blockNumber}`);
  } else {
    log("approve", `Buyer escrow allowance already set: ${fmt(buyerAllowance)} USDC ✓`);
  }

  // ── Final state ────────────────────────────────────────────────────────────
  const [finalBond, finalAllowance] = (await Promise.all([
    c.bond.bonds(sellerAA),
    c.usdc.allowance(buyerAA, ESCROW_ADDR),
  ])) as [bigint, bigint];

  console.log("\n── Setup complete ──");
  console.log(`  Seller bond:       ${fmt(finalBond)} USDC`);
  console.log(`  Buyer allowance:   ${fmt(finalAllowance)} USDC`);
  console.log(`  Seller AA:         ${sellerAA}`);
  console.log(`  Buyer AA:          ${buyerAA}`);
  console.log("\n  Ready for live x402 + Quittance on Kite mainnet 🚀\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
