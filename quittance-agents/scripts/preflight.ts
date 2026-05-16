/**
 * preflight.ts
 *
 * One-time setup before the smoke test:
 *   1. Print all wallet addresses and balances.
 *   2. Transfer 1 PYUSD from seller (deployer) to buyer.
 *   3. Deposit 1 PYUSD bond for seller (if not already bonded).
 *   4. Approve Escrow for buyer (1 PYUSD allowance).
 *
 * Designed to be conservative: leaves ~18 PYUSD in the deployer wallet.
 * Safe to run multiple times — skips steps already done.
 *
 * Usage: npm run preflight
 */
import "dotenv/config";
import { ethers } from "ethers";
import { getProvider, getSigner, getContracts, fmt, TIER_LABEL } from "../lib/contracts";

const BOND_DEPOSIT  = ethers.parseUnits("1",     18);    // 1 PYUSD for seller bond
const BUYER_FUND    = ethers.parseUnits("1",     18);    // 1 PYUSD for buyer to spend
const ESCROW_ALLOW  = ethers.parseUnits("1",     18);    // escrow allowance for buyer
const BUYER_KITE    = ethers.parseEther("0.005");         // small KITE for buyer gas

function log(step: string, msg: string) {
  console.log(`[${step.padEnd(8)}] ${msg}`);
}

async function waitTx(label: string, txP: Promise<ethers.TransactionResponse>) {
  log(label, "sending...");
  const tx = await txP;
  log(label, `tx ${tx.hash}`);
  const r = await tx.wait();
  log(label, `confirmed block ${r!.blockNumber}  gas ${r!.gasUsed}`);
  return r!;
}

async function main() {
  const provider = getProvider();
  const network  = await provider.getNetwork();
  console.log(`\nNetwork: Kite Testnet (chainId ${network.chainId})\n`);

  const buyerKey  = process.env.BUYER_PRIVATE_KEY;
  const sellerKey = process.env.SELLER_SMS_PRO_PRIVATE_KEY;
  const oracleKey = process.env.ORACLE_PRIVATE_KEY;

  if (!buyerKey || !sellerKey || !oracleKey) {
    console.error("Set BUYER_PRIVATE_KEY, SELLER_SMS_PRO_PRIVATE_KEY, ORACLE_PRIVATE_KEY");
    process.exit(1);
  }

  const buyer  = getSigner(buyerKey,  provider);
  const seller = getSigner(sellerKey, provider);

  const c = getContracts(provider);

  // ── Print balances ─────────────────────────────────────────────────────────
  const [buyerKite,  buyerPyusd]  = await Promise.all([provider.getBalance(buyer.address),  c.pyusd.balanceOf(buyer.address)]);
  const [sellerKite, sellerPyusd] = await Promise.all([provider.getBalance(seller.address), c.pyusd.balanceOf(seller.address)]);
  const sellerBond = (await c.bond.bonds(seller.address)) as bigint;
  const minBond    = (await c.bond.MIN_BOND()) as bigint;

  console.log("── Balances ──────────────────────────────────────");
  console.log(`Buyer  (${buyer.address})`);
  console.log(`  KITE:  ${fmt(buyerKite)}   PYUSD: ${fmt(buyerPyusd)}`);
  console.log(`Seller (${seller.address})`);
  console.log(`  KITE:  ${fmt(sellerKite)}  PYUSD: ${fmt(sellerPyusd)}  Bond: ${fmt(sellerBond)} / ${fmt(minBond)}`);
  console.log();

  // ── Step 0: Send buyer a tiny KITE for gas ────────────────────────────────
  if (buyerKite < BUYER_KITE) {
    const need = BUYER_KITE - buyerKite;
    log("kite", `buyer needs ${ethers.formatEther(need)} KITE for gas — sending from seller...`);
    await waitTx("kite", seller.sendTransaction({ to: buyer.address, value: need }));
  } else {
    log("kite", `buyer already has ${ethers.formatEther(buyerKite)} KITE ✓`);
  }

  // ── Step 1: Fund buyer with 1 PYUSD ───────────────────────────────────────
  if (buyerPyusd < BUYER_FUND) {
    const need = BUYER_FUND - buyerPyusd;
    log("fund", `buyer needs ${fmt(need)} PYUSD — transferring from seller...`);
    await waitTx("fund", (c.pyusd.connect(seller) as typeof c.pyusd).transfer(buyer.address, need));
  } else {
    log("fund", `buyer already has ${fmt(buyerPyusd)} PYUSD ✓`);
  }

  // ── Step 2: Deposit seller bond ────────────────────────────────────────────
  if (sellerBond < minBond) {
    const need = minBond - sellerBond;
    log("bond", `seller needs ${fmt(need)} PYUSD bond — approving + depositing...`);
    const allow: bigint = await c.pyusd.allowance(seller.address, process.env.BOND_ADDRESS!);
    if (allow < need) {
      await waitTx("bond-ok", (c.pyusd.connect(seller) as typeof c.pyusd).approve(process.env.BOND_ADDRESS!, need));
    }
    await waitTx("bond", (c.bond.connect(seller) as typeof c.bond).deposit(need));
  } else {
    log("bond", `seller already bonded (${fmt(sellerBond)} PYUSD) ✓`);
  }

  // ── Step 3: Buyer approves Escrow ──────────────────────────────────────────
  const escrowAllow: bigint = await c.pyusd.allowance(buyer.address, process.env.ESCROW_ADDRESS!);
  if (escrowAllow < ESCROW_ALLOW) {
    log("approve", `buyer approving Escrow for ${fmt(ESCROW_ALLOW)} PYUSD...`);
    await waitTx("approve", (c.pyusd.connect(buyer) as typeof c.pyusd).approve(process.env.ESCROW_ADDRESS!, ESCROW_ALLOW));
  } else {
    log("approve", `buyer Escrow allowance already sufficient (${fmt(escrowAllow)}) ✓`);
  }

  // ── Final state ────────────────────────────────────────────────────────────
  const [bKite2, bPyusd2] = await Promise.all([provider.getBalance(buyer.address), c.pyusd.balanceOf(buyer.address)]);
  const [sKite2, sPyusd2] = await Promise.all([provider.getBalance(seller.address), c.pyusd.balanceOf(seller.address)]);
  const sBond2 = await c.bond.bonds(seller.address);

  console.log("\n── Ready ─────────────────────────────────────────");
  console.log(`Buyer  KITE: ${fmt(bKite2)}  PYUSD: ${fmt(bPyusd2)}`);
  console.log(`Seller KITE: ${fmt(sKite2)}  PYUSD: ${fmt(sPyusd2)}  Bond: ${fmt(sBond2)}`);
  console.log("\nRun: npm run smoke\n");
}

main().catch(err => { console.error(err); process.exit(1); });
