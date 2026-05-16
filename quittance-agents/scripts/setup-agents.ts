/**
 * setup-agents.ts
 *
 * Derives the AA wallet address for each demo agent, checks KITE + PYUSD
 * balances, and reports bond status for each seller.
 *
 * Usage: npm run setup
 */
import "dotenv/config";
import { ethers } from "ethers";
import { GokiteAASDK } from "gokite-aa-sdk";
import { getProvider, getSigner, getContracts, fmt, TIER_LABEL } from "../lib/contracts";

const KITE_RPC     = process.env.KITE_RPC_URL     ?? "https://rpc-testnet.gokite.ai";
const BUNDLER_RPC  = process.env.KITE_BUNDLER_URL  ?? "https://bundler-service.staging.gokite.ai/rpc/";

const AGENT_KEYS: Record<string, string | undefined> = {
  buyer:       process.env.BUYER_PRIVATE_KEY,
  sms:         process.env.SELLER_SMS_PRIVATE_KEY,
  scrape:      process.env.SELLER_SCRAPE_PRIVATE_KEY,
  llm:         process.env.SELLER_LLM_PRIVATE_KEY,
  translator:  process.env.SELLER_TRANSLATOR_PRIVATE_KEY,
  pricefeed:   process.env.SELLER_PRICEFEED_PRIVATE_KEY,
};

const SELLERS = ["sms", "scrape", "llm", "translator", "pricefeed"];

async function main() {
  const provider = getProvider();
  const sdk      = new GokiteAASDK("kite_testnet", KITE_RPC, BUNDLER_RPC);
  const network  = await provider.getNetwork();
  console.log(`\nNetwork: Kite Testnet (chainId ${network.chainId})\n`);

  let allReady = true;

  for (const [name, key] of Object.entries(AGENT_KEYS)) {
    if (!key) {
      console.log(`⚠️  ${name.padEnd(12)} — private key not set in .env`);
      allReady = false;
      continue;
    }

    const wallet  = getSigner(key, provider);
    const eoa     = wallet.address;
    const aaWallet = sdk.getAccountAddress(eoa);

    const [kiteBalance, usdtBalance] = await Promise.all([
      provider.getBalance(aaWallet),
      getContracts(provider).pyusd.balanceOf(aaWallet),
    ]);

    const isSeller = SELLERS.includes(name);
    let bondBalance = 0n;
    let minBond     = 0n;
    let bonded      = false;

    if (isSeller) {
      const { bond } = getContracts(provider);
      [bondBalance, minBond] = await Promise.all([
        bond.bonds(aaWallet),
        bond.MIN_BOND(),
      ]);
      bonded = bondBalance >= minBond;
    }

    const kiteOk = kiteBalance > 0n;
    const usdtOk = usdtBalance > 0n;
    const bondOk = !isSeller || bonded;
    const ready  = kiteOk && usdtOk && bondOk;
    if (!ready) allReady = false;

    const status = ready ? "✅" : "❌";
    console.log(`${status} ${name.padEnd(12)}  EOA: ${eoa}`);
    console.log(`   AA wallet:  ${aaWallet}`);
    console.log(`   KITE:       ${fmt(kiteBalance, 18)} ${kiteOk ? "" : "← needs gas"}`);
    console.log(`   USDT:       ${fmt(usdtBalance, 18)} ${usdtOk ? "" : "← needs tokens (faucet.gokite.ai)"}`);
    if (isSeller) {
      console.log(`   Bond:       ${fmt(bondBalance, 18)} / ${fmt(minBond, 18)} USDT ${bondOk ? "" : "← needs deposit"}`);
    }
    console.log();
  }

  if (!allReady) {
    console.log("──────────────────────────────────────────────────");
    console.log("Some agents are not ready. Steps to fix:");
    console.log("  1. Fund each AA wallet with KITE for gas:");
    console.log("     kpass faucet drop --recipient <aaWallet> --token KITE");
    console.log("  2. Fund each AA wallet with Test USDT:");
    console.log("     → faucet.gokite.ai (paste the AA wallet address)");
    console.log("  3. For sellers, approve + deposit bond:");
    console.log(`     token.approve(BOND, minBond) then bond.deposit(minBond)`);
    console.log("     Run this script again after funding to re-check.\n");
  } else {
    console.log("All agents ready. Run: npm run smoke\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
