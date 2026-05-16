/**
 * e2e-smoke.ts
 *
 * End-to-end smoke test against Kite testnet using plain EOA signers.
 * Proves the full contract stack works on-chain before the AA/gasless
 * SDK layer is integrated in Phase 2.
 *
 * Flow:
 *   0. Seller deposits bond (if not already bonded).
 *   1. Buyer EOA approves Escrow for USDT.
 *   2. Seller EOA calls Escrow.openEscrow (pulls USDT from buyer).
 *   3. Oracle EOA signs the delivery proof.
 *   4. Seller EOA calls QuittanceRegistry.post → triggers escrow settle.
 *   5. Verify escrow is settled, print paymentId + tx hashes.
 *
 * Usage: npm run smoke
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
} from "../lib/contracts";

// 0.01 USDT per payment
const PAYMENT_AMOUNT = ethers.parseUnits("0.01", 18);
// 5-minute delivery window
const DEADLINE_OFFSET = 300n;

function log(step: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${step}] ${msg}`);
}

async function waitForTx(label: string, txPromise: Promise<ethers.TransactionResponse>) {
  log(label, "sending...");
  const tx = await txPromise;
  log(label, `tx ${tx.hash}`);
  const receipt = await tx.wait();
  log(label, `confirmed block ${receipt!.blockNumber}  gas ${receipt!.gasUsed}`);
  return receipt!;
}

async function main() {
  const provider = getProvider();

  const buyerKey  = process.env.BUYER_PRIVATE_KEY;
  const sellerKey = process.env.SELLER_SMS_PRIVATE_KEY;
  const oracleKey = process.env.ORACLE_PRIVATE_KEY;

  if (!buyerKey || !sellerKey || !oracleKey) {
    console.error("Set BUYER_PRIVATE_KEY, SELLER_SMS_PRIVATE_KEY, ORACLE_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const buyer  = getSigner(buyerKey,  provider);
  const seller = getSigner(sellerKey, provider);
  const oracle = getSigner(oracleKey, provider);

  console.log("\n── Quittance E2E Smoke Test (EOA) ───────────────────\n");
  console.log(`Buyer:  ${buyer.address}`);
  console.log(`Seller: ${seller.address}`);
  console.log(`Oracle: ${oracle.address}`);
  console.log();

  const c = getContracts(provider);

  // ── Pre-flight ──────────────────────────────────────────────────────────────
  const [buyerKite, buyerUsdt, sellerBond, minBond] = await Promise.all([
    provider.getBalance(buyer.address),
    c.pyusd.balanceOf(buyer.address),
    c.bond.bonds(seller.address),
    c.bond.MIN_BOND(),
  ]);

  log("preflight", `buyer  KITE: ${fmt(buyerKite)}  USDT: ${fmt(buyerUsdt)}`);
  log("preflight", `seller bond: ${fmt(sellerBond)} / min ${fmt(minBond)} USDT`);

  if (buyerUsdt < PAYMENT_AMOUNT) {
    console.error(`\n❌ Buyer (${buyer.address}) needs ≥ ${fmt(PAYMENT_AMOUNT)} PYUSD`);
    console.error(`   Has: ${fmt(buyerUsdt)}  →  faucet.gokite.ai\n`);
    process.exit(1);
  }

  // ── Step 0: Bond deposit (if needed) ───────────────────────────────────────
  if (sellerBond < minBond) {
    log("step 0", `seller not bonded — depositing ${fmt(minBond)} PYUSD...`);

    const pyusdWithSeller = c.pyusd.connect(seller) as typeof c.pyusd;
    const allowance: bigint = await c.pyusd.allowance(seller.address, process.env.BOND_ADDRESS!);
    if (allowance < minBond) {
      await waitForTx("step 0a", pyusdWithSeller.approve(process.env.BOND_ADDRESS!, minBond));
    }

    const bondWithSeller = c.bond.connect(seller) as typeof c.bond;
    await waitForTx("step 0b", bondWithSeller.deposit(minBond));
    log("step 0", `✅ bonded`);
  } else {
    log("step 0", `seller already bonded (${fmt(sellerBond)} PYUSD) ✓`);
  }

  // ── Step 1: Buyer approves Escrow ───────────────────────────────────────────
  log("step 1", "buyer approves Escrow for PYUSD...");
  const pyusdWithBuyer = c.pyusd.connect(buyer) as typeof c.pyusd;
  const allowance: bigint = await c.pyusd.allowance(buyer.address, process.env.ESCROW_ADDRESS!);
  if (allowance < PAYMENT_AMOUNT) {
    await waitForTx("step 1", pyusdWithBuyer.approve(process.env.ESCROW_ADDRESS!, PAYMENT_AMOUNT));
  } else {
    log("step 1", `allowance already sufficient (${fmt(allowance)}) ✓`);
  }

  // ── Step 2: Open escrow ─────────────────────────────────────────────────────
  log("step 2", "seller opens escrow...");

  const block     = await provider.getBlock("latest");
  const deadline  = BigInt(block!.timestamp) + DEADLINE_OFFSET;
  const authNonce = ethers.randomBytes(32);
  const paymentId = makePaymentId(
    buyer.address, seller.address, PAYMENT_AMOUNT, deadline, authNonce
  );

  const REQUEST_HASH = ethers.keccak256(ethers.toUtf8Bytes("send sms: smoke test"));
  const RESULT_HASH  = ethers.keccak256(ethers.toUtf8Bytes("sms delivered: smoke_sid_001"));

  log("params", `paymentId: ${paymentId}`);
  log("params", `deadline:  ${new Date(Number(deadline) * 1000).toISOString()}`);

  const escrowWithSeller = c.escrow.connect(seller) as typeof c.escrow;
  await waitForTx(
    "step 2",
    escrowWithSeller.openEscrow(
      paymentId, buyer.address, seller.address, PAYMENT_AMOUNT, deadline, ProofType.ORACLE
    )
  );

  const [, , escrowAmount, , settled0] = await c.escrow.getEscrowRecord(paymentId);
  log("step 2", `✅ locked ${fmt(escrowAmount)} USDT  settled=${settled0}`);

  // ── Step 3: Oracle signs ────────────────────────────────────────────────────
  log("step 3", "oracle signs delivery proof...");
  const proof = await signOracleProof(oracle, paymentId, RESULT_HASH);
  log("step 3", `✅ sig ${proof.slice(0, 22)}...`);

  // ── Step 4: Post quittance ──────────────────────────────────────────────────
  log("step 4", "seller posts quittance...");
  const registryWithSeller = c.registry.connect(seller) as typeof c.registry;
  await waitForTx(
    "step 4",
    registryWithSeller.post({
      paymentId,
      requestHash:    REQUEST_HASH,
      resultHash:     RESULT_HASH,
      sellerPassport: seller.address,
      buyerPassport:  buyer.address,
      proofType:      ProofType.ORACLE,
      proofPayload:   proof,
      attestor:       oracle.address,
      deliveredAt:    0n,
      deadline,
    })
  );

  // ── Results ─────────────────────────────────────────────────────────────────
  const [, , , , settled1, refunded] = await c.escrow.getEscrowRecord(paymentId);
  const quittance = await c.registry.getQuittance(paymentId);
  const [successCount, volume] = await Promise.all([
    c.registry.successCount(seller.address),
    c.registry.totalVolume(seller.address),
  ]);

  console.log("\n── Results ───────────────────────────────────────────\n");
  console.log(`paymentId:        ${paymentId}`);
  console.log(`escrow settled:   ${settled1}`);
  console.log(`quittance block:  ${quittance.deliveredAt}`);
  console.log(`proof type:       ORACLE`);
  console.log(`seller successes: ${successCount}`);
  console.log(`seller volume:    ${fmt(volume)} USDT`);

  console.log();
  if (settled1) {
    console.log("✅ PASS — full oracle quittance cycle confirmed on Kite testnet");
  } else {
    console.log("❌ FAIL — escrow not settled");
    process.exit(1);
  }
  console.log("\n── Smoke test complete ───────────────────────────────\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
