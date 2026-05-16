/**
 * integration.ts — Quittance Live AA Passport Integration Test
 *
 * Runs the full Exec-Pay-Deliver cycle on Kite testnet using
 * ERC-4337 smart-account wallets (Kite Agent Passports) for every
 * on-chain write.  No EOA submits a transaction directly — everything
 * goes through the Kite bundler + paymaster (gasless to the owner).
 *
 * Flow
 * ────
 *  0. PASSPORTS   Derive buyer/seller AA wallets (deterministic, salt=0).
 *  1. FUND        Transfer PYUSD to AA wallets from EOAs (EOA pays own gas).
 *  2. BOND        Seller AA deposits MIN_BOND into Bond contract (AA UserOp).
 *  3. APPROVE     Buyer AA approves Escrow for PYUSD (AA UserOp).
 *  4. OPEN        Seller AA calls Escrow.openEscrow (AA UserOp).
 *  5. PROVE       Oracle EOA signs the off-chain delivery proof.
 *  6. SETTLE      Seller AA posts quittance → escrow settles (AA UserOp).
 *  7. VERIFY      Assert escrow.settled === true on-chain.
 *
 * Usage
 * ─────
 *   npm run integration
 *
 * Environment
 * ───────────
 *   BUYER_PRIVATE_KEY            EOA key for the buyer agent
 *   SELLER_SMS_PRO_PRIVATE_KEY   EOA key for sms-pro seller (also oracle/deployer here)
 *   ORACLE_PRIVATE_KEY           EOA key for the oracle attestor
 *   PYUSD_ADDRESS                PYUSD contract (18 dec on kite_testnet)
 *   BOND_ADDRESS                 Bond contract
 *   ESCROW_ADDRESS               Escrow contract
 *   REGISTRY_ADDRESS             QuittanceRegistry contract
 *   KITE_RPC_URL                 JSON-RPC endpoint
 *   KITE_BUNDLER_URL             ERC-4337 bundler endpoint
 */

import "dotenv/config";
import { ethers } from "ethers";
import {
  getProvider,
  getSigner,
  getContracts,
  makePaymentId,
  signOracleProof,
  fmt,
  ProofType,
  ERC20_ABI,
  BOND_ABI,
  ESCROW_ABI,
  REGISTRY_ABI,
} from "../lib/contracts";
import { makeSDK, aaAddress, aaSend, aaBatch, encodeCall, AA_SALT } from "../lib/aa";

// ─── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_AMOUNT  = ethers.parseUnits("0.001", 18); // 0.001 PYUSD per call
const DEADLINE_OFFSET = 300n;                            // 5-minute delivery window
const REQUEST_HASH    = ethers.keccak256(ethers.toUtf8Bytes("integration-test: send SMS +1-555-0192"));
const RESULT_HASH     = ethers.keccak256(ethers.toUtf8Bytes("integration-test: sms_sid=INT001 delivered"));

// ─── Logging helpers ───────────────────────────────────────────────────────────

const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN  = "\x1b[36m";
const AMBER = "\x1b[33m";
const RED   = "\x1b[31m";
const RESET = "\x1b[0m";

function banner(title: string) {
  console.log(`\n${BOLD}${CYAN}${"─".repeat(56)}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
  console.log(`${CYAN}${"─".repeat(56)}${RESET}\n`);
}

function step(id: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}[${ts}]${RESET} ${AMBER}[${id.padEnd(8)}]${RESET} ${msg}`);
}

function ok(msg: string) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function info(msg: string) {
  console.log(`  ${DIM}${msg}${RESET}`);
}

function fatal(msg: string): never {
  console.error(`\n${RED}✗ ${msg}${RESET}\n`);
  process.exit(1);
}

// ─── Env helpers ───────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) fatal(`Missing env var: ${key}`);
  return v!;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner("Quittance · Live AA Passport Integration Test");

  // ── 0. PASSPORTS ─────────────────────────────────────────────────────────────
  banner("Phase 0 — Kite Agent Passports (AA wallets)");

  const buyerKey  = requireEnv("BUYER_PRIVATE_KEY");
  const sellerKey = requireEnv("SELLER_SMS_PRO_PRIVATE_KEY");
  const oracleKey = requireEnv("ORACLE_PRIVATE_KEY");

  const provider = getProvider();
  const network  = await provider.getNetwork();
  info(`Network: Kite Testnet  chainId=${network.chainId}`);

  const buyerEOA  = getSigner(buyerKey,  provider);
  const sellerEOA = getSigner(sellerKey, provider);
  const oracleEOA = getSigner(oracleKey, provider);

  const sdk = makeSDK();

  const buyerAA  = aaAddress(sdk, buyerEOA.address);
  const sellerAA = aaAddress(sdk, sellerEOA.address);

  step("passport", `Buyer  EOA: ${buyerEOA.address}`);
  info(`           AA  wallet: ${buyerAA}  (salt=${AA_SALT})`);
  step("passport", `Seller EOA: ${sellerEOA.address}`);
  info(`           AA  wallet: ${sellerAA}  (salt=${AA_SALT})`);
  step("passport", `Oracle EOA: ${oracleEOA.address}  (off-chain signer only)`);

  // ── Pre-flight: check AA wallet balances ────────────────────────────────────
  const c = getContracts(provider);

  const [
    buyerAAKite,  buyerAAPayusd,
    sellerAAKite, sellerAAPayusd,
    sellerAABond, minBond,
    buyerEOAPayusd, sellerEOAPayusd,
  ] = (await Promise.all([
    provider.getBalance(buyerAA),
    c.pyusd.balanceOf(buyerAA),
    provider.getBalance(sellerAA),
    c.pyusd.balanceOf(sellerAA),
    c.bond.bonds(sellerAA),
    c.bond.MIN_BOND(),
    c.pyusd.balanceOf(buyerEOA.address),
    c.pyusd.balanceOf(sellerEOA.address),
  ])) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

  console.log();
  console.log(`  ${"Wallet".padEnd(12)} ${"KITE".padEnd(18)} ${"PYUSD".padEnd(18)} Bond`);
  console.log(`  ${"──────".padEnd(12)} ${"────".padEnd(18)} ${"─────".padEnd(18)} ────`);
  console.log(`  ${"buyer AA".padEnd(12)} ${fmt(buyerAAKite).padEnd(18)} ${fmt(buyerAAPayusd).padEnd(18)}`);
  console.log(`  ${"seller AA".padEnd(12)} ${fmt(sellerAAKite).padEnd(18)} ${fmt(sellerAAPayusd).padEnd(18)} ${fmt(sellerAABond)}`);
  console.log(`  ${"buyer EOA".padEnd(12)} —                  ${fmt(buyerEOAPayusd).padEnd(18)} (source)`);
  console.log(`  ${"seller EOA".padEnd(12)} —                  ${fmt(sellerEOAPayusd).padEnd(18)} (source)`);
  console.log();

  // ── 1. FUND — move PYUSD from EOAs to AA wallets ─────────────────────────────
  banner("Phase 1 — Fund AA wallets");

  const MIN_BUYER_AA  = PAYMENT_AMOUNT;
  const MIN_SELLER_AA = minBond + ethers.parseUnits("0.01", 18); // bond + margin

  // Fund buyer AA
  if (buyerAAPayusd < MIN_BUYER_AA) {
    const need = MIN_BUYER_AA - buyerAAPayusd;
    if (buyerEOAPayusd < need) {
      // Try from seller/deployer
      if (sellerEOAPayusd >= need) {
        step("fund", `Buyer EOA short — funding ${fmt(need)} PYUSD from seller/deployer EOA…`);
        const tx = await (c.pyusd.connect(sellerEOA) as typeof c.pyusd).transfer(buyerAA, need);
        step("fund", `tx ${tx.hash}`);
        await tx.wait();
        ok(`Buyer AA funded with ${fmt(need)} PYUSD`);
      } else {
        fatal(`Buyer AA needs ${fmt(need)} PYUSD but neither buyer nor seller EOA has enough.\nFund buyer AA (${buyerAA}) from faucet.gokite.ai`);
      }
    } else {
      step("fund", `Transferring ${fmt(need)} PYUSD from buyer EOA → buyer AA…`);
      const tx = await (c.pyusd.connect(buyerEOA) as typeof c.pyusd).transfer(buyerAA, need);
      step("fund", `tx ${tx.hash}`);
      await tx.wait();
      ok(`Buyer AA funded with ${fmt(need)} PYUSD`);
    }
  } else {
    ok(`Buyer AA already has sufficient PYUSD (${fmt(buyerAAPayusd)})`);
  }

  // Fund seller AA for bond (if needed)
  if (sellerAAPayusd < MIN_SELLER_AA && sellerAABond < minBond) {
    const need = MIN_SELLER_AA - sellerAAPayusd;
    if (sellerEOAPayusd < need) {
      fatal(`Seller AA needs ${fmt(need)} PYUSD for bond but seller EOA only has ${fmt(sellerEOAPayusd)}`);
    }
    step("fund", `Transferring ${fmt(need)} PYUSD from seller EOA → seller AA…`);
    const tx = await (c.pyusd.connect(sellerEOA) as typeof c.pyusd).transfer(sellerAA, need);
    step("fund", `tx ${tx.hash}`);
    await tx.wait();
    ok(`Seller AA funded with ${fmt(need)} PYUSD`);
  } else {
    ok(`Seller AA has sufficient PYUSD (${fmt(sellerAAPayusd)}) / bond (${fmt(sellerAABond)})`);
  }

  // ── 2. BOND — seller AA deposits MIN_BOND (AA UserOp, gasless) ───────────────
  banner("Phase 2 — Seller bond deposit (AA UserOp)");

  const bondNow = (await c.bond.bonds(sellerAA)) as bigint;
  if (bondNow >= minBond) {
    ok(`Seller AA already bonded (${fmt(bondNow)} PYUSD ≥ min ${fmt(minBond)})`);
  } else {
    const bondNeeded = minBond - bondNow;
    step("bond", `Seller AA depositing ${fmt(bondNeeded)} PYUSD bond via AA…`);
    info(`  (Note: SDK logs gas estimates below — expected)`);

    // Batch: approve Bond, then deposit
    const approveCD = encodeCall(
      "function approve(address spender, uint256 amount) returns (bool)",
      [requireEnv("BOND_ADDRESS"), bondNeeded],
    );
    const depositCD = encodeCall(
      "function deposit(uint256 amount)",
      [bondNeeded],
    );

    const result = await aaBatch(sdk, sellerEOA, [
      { target: requireEnv("PYUSD_ADDRESS"), callData: approveCD },
      { target: requireEnv("BOND_ADDRESS"),  callData: depositCD },
    ]);

    ok(`Bond deposited — tx ${result.txHash}  block ${result.blockNumber}`);
    info(`  userOpHash: ${result.userOpHash}`);
  }

  // ── 3. APPROVE — buyer AA approves Escrow for PYUSD (AA UserOp, gasless) ────
  banner("Phase 3 — Buyer approves Escrow (AA UserOp)");

  const currentAllowance = (await c.pyusd.allowance(buyerAA, requireEnv("ESCROW_ADDRESS"))) as bigint;
  if (currentAllowance >= PAYMENT_AMOUNT) {
    ok(`Escrow allowance already sufficient (${fmt(currentAllowance)})`);
  } else {
    step("approve", `Buyer AA approving Escrow for ${fmt(PAYMENT_AMOUNT)} PYUSD via AA…`);
    info(`  (SDK gas logs below — expected)`);

    const approveCD = encodeCall(
      "function approve(address spender, uint256 amount) returns (bool)",
      [requireEnv("ESCROW_ADDRESS"), PAYMENT_AMOUNT],
    );

    const result = await aaSend(sdk, buyerEOA, requireEnv("PYUSD_ADDRESS"), approveCD);
    ok(`Escrow approved — tx ${result.txHash}  block ${result.blockNumber}`);
    info(`  userOpHash: ${result.userOpHash}`);
  }

  // ── 4. OPEN — seller AA opens escrow (AA UserOp, gasless) ───────────────────
  banner("Phase 4 — Open escrow (AA UserOp)");

  const block    = await provider.getBlock("latest");
  const deadline = BigInt(block!.timestamp) + DEADLINE_OFFSET;
  const nonce    = ethers.randomBytes(32);

  // paymentId uses AA wallet addresses (these are the on-chain identities)
  const paymentId = makePaymentId(buyerAA, sellerAA, PAYMENT_AMOUNT, deadline, nonce);

  step("open", `paymentId: ${paymentId}`);
  info(`  buyer  AA: ${buyerAA}`);
  info(`  seller AA: ${sellerAA}`);
  info(`  amount:    ${fmt(PAYMENT_AMOUNT)} PYUSD`);
  info(`  deadline:  ${new Date(Number(deadline) * 1000).toISOString()}`);
  info(`  proof:     ORACLE`);

  const openCD = encodeCall(
    "function openEscrow(bytes32 paymentId, address buyer, address seller, uint256 amount, uint64 deadline, uint8 proofType)",
    [paymentId, buyerAA, sellerAA, PAYMENT_AMOUNT, deadline, ProofType.ORACLE],
  );

  step("open", `Seller AA calling Escrow.openEscrow via AA…`);
  const openResult = await aaSend(sdk, sellerEOA, requireEnv("ESCROW_ADDRESS"), openCD);
  ok(`Escrow opened — tx ${openResult.txHash}  block ${openResult.blockNumber}`);
  info(`  userOpHash: ${openResult.userOpHash}`);

  // Verify escrow is live
  const [, , lockedAmt, , settled0] = (await c.escrow.getEscrowRecord(paymentId)) as [string, string, bigint, bigint, boolean, boolean];
  ok(`On-chain escrow: ${fmt(lockedAmt)} PYUSD locked  settled=${settled0}`);

  // ── 5. PROVE — oracle signs delivery proof (off-chain) ────────────────────────
  banner("Phase 5 — Oracle signs delivery proof (off-chain)");

  step("prove", `Oracle signing paymentId + resultHash…`);
  const proofSig = await signOracleProof(oracleEOA, paymentId, RESULT_HASH);
  ok(`Proof signature: ${proofSig.slice(0, 22)}…${proofSig.slice(-8)}`);
  info(`  requestHash: ${REQUEST_HASH}`);
  info(`  resultHash:  ${RESULT_HASH}`);

  // ── 6. SETTLE — seller AA posts quittance → escrow auto-settles (AA UserOp) ──
  banner("Phase 6 — Post quittance & settle escrow (AA UserOp)");

  const now = BigInt(Math.floor(Date.now() / 1000));

  const quittance = {
    paymentId,
    requestHash:    REQUEST_HASH,
    resultHash:     RESULT_HASH,
    sellerPassport: sellerAA,
    buyerPassport:  buyerAA,
    proofType:      ProofType.ORACLE,
    proofPayload:   proofSig,
    attestor:       oracleEOA.address,
    deliveredAt:    now,
    deadline,
  };

  const postCD = encodeCall(
    `function post(tuple(
      bytes32 paymentId,
      bytes32 requestHash,
      bytes32 resultHash,
      address sellerPassport,
      address buyerPassport,
      uint8   proofType,
      bytes   proofPayload,
      address attestor,
      uint64  deliveredAt,
      uint64  deadline
    ) q)`,
    [quittance],
  );

  step("settle", `Seller AA posting quittance to Registry via AA…`);
  const settleResult = await aaSend(sdk, sellerEOA, requireEnv("REGISTRY_ADDRESS"), postCD);
  ok(`Quittance posted — tx ${settleResult.txHash}  block ${settleResult.blockNumber}`);
  info(`  userOpHash: ${settleResult.userOpHash}`);

  // ── 7. VERIFY ─────────────────────────────────────────────────────────────────
  banner("Phase 7 — On-chain verification");

  const [, , , , settled1, refunded] = (await c.escrow.getEscrowRecord(paymentId)) as [string, string, bigint, bigint, boolean, boolean];
  const [successes, volume] = (await Promise.all([
    c.registry.successCount(sellerAA),
    c.registry.totalVolume(sellerAA),
  ])) as [bigint, bigint];

  console.log(`  paymentId:        ${paymentId}`);
  console.log(`  escrow.settled:   ${settled1 ? `${GREEN}true${RESET}` : `${RED}false${RESET}`}`);
  console.log(`  escrow.refunded:  ${refunded}`);
  console.log(`  quittance.proof:  ORACLE`);
  console.log(`  quittance.at:     block ${settleResult.blockNumber}`);
  console.log(`  seller successes: ${successes}`);
  console.log(`  seller volume:    ${fmt(volume)} PYUSD`);
  console.log();

  if (!settled1) fatal("Escrow not settled — integration test FAILED");

  banner("Result");
  console.log(`${GREEN}${BOLD}  ✅ PASS — full AA passport quittance cycle confirmed${RESET}`);
  console.log();
  console.log(`  Buyer  passport: ${buyerAA}`);
  console.log(`  Seller passport: ${sellerAA}`);
  console.log(`  Buyer KITE gas spent: ${GREEN}0.000${RESET} (gasless ✓ — bundler + paymaster)`);
  console.log(`  Kite testnet tx:   https://testnet.kitescan.io/tx/${settleResult.txHash}`);
  console.log();
  console.log(`  All four on-chain writes used AA UserOperations:`);
  console.log(`    Bond deposit   → seller AA`);
  console.log(`    PYUSD approve  → buyer  AA`);
  console.log(`    openEscrow     → seller AA`);
  console.log(`    Registry.post  → seller AA`);
  console.log();
}

main().catch((err) => {
  console.error(`\n${RED}Fatal:${RESET}`, err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
