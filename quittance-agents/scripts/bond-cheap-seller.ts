import "dotenv/config";
import { ethers } from "ethers";
import { makeSDK, aaAddress, aaBatch, encodeCall } from "../lib/aa";
import { getProvider, getSigner, fmt } from "../lib/contracts";

async function main() {
  const provider = getProvider();
  const cheapKey = process.env.SELLER_EMAIL_CHEAP_PRIVATE_KEY!;
  const cheapEOA = getSigner(cheapKey, provider);
  const sdk      = makeSDK();
  const cheapAA  = aaAddress(sdk, cheapEOA.address);

  const USDC_ADDR = process.env.USDC_ADDRESS!;
  const BOND_ADDR = process.env.BOND_ADDRESS!;
  const AMOUNT    = BigInt(1_000_000); // 1.0 USDC

  console.log("Email-cheap AA:", cheapAA);

  const bond = new ethers.Contract(
    BOND_ADDR,
    ["function bonds(address) view returns (uint256)", "function MIN_BOND() view returns (uint256)"],
    provider,
  );
  const [existing, minBond] = await Promise.all([
    bond.bonds(cheapAA) as Promise<bigint>,
    bond.MIN_BOND()     as Promise<bigint>,
  ]);
  console.log(`Current bond: ${fmt(existing)} USDC  (min ${fmt(minBond)} USDC)`);

  if (existing >= minBond) {
    console.log("Already sufficiently bonded ✓");
    return;
  }

  console.log("Approving Bond contract + depositing 1.0 USDC (batched AA UserOp)…");
  const approveCD = encodeCall("function approve(address spender, uint256 amount)", [BOND_ADDR, AMOUNT]);
  const depositCD = encodeCall("function deposit(uint256 amount)", [AMOUNT]);

  const result = await aaBatch(sdk, cheapEOA, [
    { target: USDC_ADDR, callData: approveCD },
    { target: BOND_ADDR, callData: depositCD },
  ]);
  console.log("✓ Bond deposited  tx:", result.txHash, " block:", result.blockNumber);

  const after = await bond.bonds(cheapAA) as bigint;
  console.log("Bond balance after:", fmt(after), "USDC", after >= minBond ? "✓" : "← still below min?");
}

main().catch((e) => { console.error(e); process.exit(1); });
