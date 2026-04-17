/**
 * Seed script — run after deploy.ts on testnet.
 * Mints testnet tokens to demo seller wallets and deposits bonds.
 *
 * Usage: hardhat run scripts/seed.ts --network kite_testnet
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const networkName = network.name;
  const deploymentPath = path.join(__dirname, `../deployments/${networkName}.json`);

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`No deployment found for ${networkName}. Run deploy.ts first.`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const { Bond: bondAddress, token } = deployment.contracts
    ? { Bond: deployment.contracts.Bond, token: deployment.token }
    : (() => { throw new Error("Invalid deployment file"); })();

  const [deployer] = await ethers.getSigners();
  const bond = await ethers.getContractAt("Bond", bondAddress);
  const tokenContract = await ethers.getContractAt("IERC20", token.address);

  // Seller EOA addresses from environment
  const sellerEnvKeys = [
    "SELLER_SMS_EOA",
    "SELLER_SCRAPE_EOA",
    "SELLER_LLM_EOA",
    "SELLER_TRANSLATOR_EOA",
    "SELLER_PRICEFEED_EOA",
  ];

  const sellers = sellerEnvKeys
    .map((k) => process.env[k])
    .filter((addr): addr is string => !!addr);

  if (sellers.length === 0) {
    console.log(
      "No seller EOAs configured. Set SELLER_*_EOA env vars to seed bonds.\n" +
        "Example: SELLER_SMS_EOA=0x... SELLER_SCRAPE_EOA=0x..."
    );
    return;
  }

  const minBond = await bond.MIN_BOND();
  console.log(`MIN_BOND: ${ethers.formatUnits(minBond, token.decimals)} ${token.symbol}`);

  for (const seller of sellers) {
    const balance = await tokenContract.balanceOf(deployer.address);
    console.log(
      `\nSeeding ${seller}... deployer balance: ${ethers.formatUnits(balance, token.decimals)}`
    );

    // Transfer tokens to seller
    const transferAmount = minBond * 2n; // give them 2× min so they have headroom
    await (await tokenContract.transfer(seller, transferAmount)).wait();
    console.log(`  Transferred ${ethers.formatUnits(transferAmount, token.decimals)} ${token.symbol}`);

    // The seller itself must approve + deposit; in a scripted demo we do this
    // via a dedicated signer. For simplicity here we just log the requirement.
    console.log(
      `  → Seller must call: bond.approve(${bondAddress}, ${minBond}) then bond.deposit(${minBond})`
    );
  }

  console.log("\nSeed complete. Sellers must deposit their own bonds.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
