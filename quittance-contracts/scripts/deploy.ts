import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Network-specific constants ───────────────────────────────────────────────

const NETWORK_CONFIG: Record<
  string,
  { tokenAddress: string; minBond: bigint; tokenSymbol: string; tokenDecimals: number }
> = {
  kite_testnet: {
    // PYUSD on Kite testnet (18 decimals)
    tokenAddress: "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9",
    minBond: ethers.parseUnits("1", 18), // 1 PYUSD
    tokenSymbol: "PYUSD",
    tokenDecimals: 18,
  },
  kite_mainnet: {
    // Bridged USDC on Kite mainnet (6 decimals)
    tokenAddress: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
    minBond: ethers.parseUnits("1", 6), // 1 USDC.e
    tokenSymbol: "USDC.e",
    tokenDecimals: 6,
  },
  hardhat: {
    // Filled in by the deploy script using a mock ERC-20.
    tokenAddress: "", // set dynamically
    minBond: ethers.parseUnits("1", 18),
    tokenSymbol: "MOCK",
    tokenDecimals: 18,
  },
  localhost: {
    tokenAddress: "",
    minBond: ethers.parseUnits("1", 18),
    tokenSymbol: "MOCK",
    tokenDecimals: 18,
  },
};

async function main() {
  const networkName = network.name;
  const [deployer] = await ethers.getSigners();

  console.log(`\nDeploying to: ${networkName}`);
  console.log(`Deployer:     ${deployer.address}`);
  console.log(
    `Balance:      ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} KITE\n`
  );

  const cfg = NETWORK_CONFIG[networkName];
  if (!cfg) throw new Error(`No network config for: ${networkName}`);

  let tokenAddress = process.env.TOKEN_ADDRESS_OVERRIDE || cfg.tokenAddress;

  // On local networks, deploy a mock ERC-20 so we can run tests without real tokens.
  if ((networkName === "hardhat" || networkName === "localhost") && !tokenAddress) {
    console.log("Deploying MockERC20...");
    const Mock = await ethers.getContractFactory("MockERC20");
    const mock = await Mock.deploy("Mock PYUSD", "PYUSD", 18);
    await mock.waitForDeployment();
    tokenAddress = await mock.getAddress();
    console.log(`MockERC20:    ${tokenAddress}`);
  }

  // ── 1. AdapterRegistry ──────────────────────────────────────────────────────
  console.log("Deploying AdapterRegistry...");
  const AdapterRegistry = await ethers.getContractFactory("AdapterRegistry");
  const adapterRegistry = await AdapterRegistry.deploy();
  await adapterRegistry.waitForDeployment();
  const adapterRegistryAddress = await adapterRegistry.getAddress();
  console.log(`AdapterRegistry: ${adapterRegistryAddress}`);

  // ── 2. Bond ─────────────────────────────────────────────────────────────────
  console.log("Deploying Bond...");
  const Bond = await ethers.getContractFactory("Bond");
  const bond = await Bond.deploy(tokenAddress, cfg.minBond);
  await bond.waitForDeployment();
  const bondAddress = await bond.getAddress();
  console.log(`Bond:            ${bondAddress}`);

  // ── 3. Escrow ───────────────────────────────────────────────────────────────
  console.log("Deploying Escrow...");
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(tokenAddress, bondAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`Escrow:          ${escrowAddress}`);

  // ── 4. QuittanceRegistry ────────────────────────────────────────────────────
  console.log("Deploying QuittanceRegistry...");
  const QuittanceRegistry = await ethers.getContractFactory("QuittanceRegistry");
  const registry = await QuittanceRegistry.deploy(adapterRegistryAddress, escrowAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`QuittanceRegistry: ${registryAddress}`);

  // ── 5. ReputationView ───────────────────────────────────────────────────────
  console.log("Deploying ReputationView...");
  const ReputationView = await ethers.getContractFactory("ReputationView");
  const reputationView = await ReputationView.deploy(registryAddress, escrowAddress, bondAddress);
  await reputationView.waitForDeployment();
  const reputationViewAddress = await reputationView.getAddress();
  console.log(`ReputationView:  ${reputationViewAddress}`);

  // ── 6. OracleAdapter ────────────────────────────────────────────────────────
  console.log("Deploying OracleAdapter...");
  const OracleAdapter = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = await OracleAdapter.deploy();
  await oracleAdapter.waitForDeployment();
  const oracleAdapterAddress = await oracleAdapter.getAddress();
  console.log(`OracleAdapter:   ${oracleAdapterAddress}`);

  // ── 7. TimeoutAdapter ───────────────────────────────────────────────────────
  console.log("Deploying TimeoutAdapter...");
  const TimeoutAdapter = await ethers.getContractFactory("TimeoutAdapter");
  const timeoutAdapter = await TimeoutAdapter.deploy(escrowAddress);
  await timeoutAdapter.waitForDeployment();
  const timeoutAdapterAddress = await timeoutAdapter.getAddress();
  console.log(`TimeoutAdapter:  ${timeoutAdapterAddress}`);

  // ── Post-deploy wiring ──────────────────────────────────────────────────────
  console.log("\nWiring contracts...");

  await (await bond.setEscrow(escrowAddress)).wait();
  console.log("  Bond.setEscrow ✓");

  await (await escrow.setRegistry(registryAddress)).wait();
  console.log("  Escrow.setRegistry ✓");

  // ProofType enum: ORACLE=0, TEE=1, ZKTLS=2, COSIGN=3, THRESHOLD=4, TIMEOUT=5
  await (await adapterRegistry.register(0, oracleAdapterAddress)).wait();
  console.log("  AdapterRegistry: ORACLE registered ✓");

  await (await adapterRegistry.register(5, timeoutAdapterAddress)).wait();
  console.log("  AdapterRegistry: TIMEOUT registered ✓");

  // Register oracle attestor if provided
  const attestorAddress = process.env.ORACLE_ATTESTOR_ADDRESS;
  if (attestorAddress) {
    await (await oracleAdapter.registerAttestor(attestorAddress)).wait();
    console.log(`  OracleAdapter: attestor ${attestorAddress} registered ✓`);
  } else {
    console.log("  OracleAdapter: no attestor registered (set ORACLE_ATTESTOR_ADDRESS to register)");
  }

  // ── Save deployment addresses ────────────────────────────────────────────────
  const deployment = {
    network: networkName,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    token: {
      address: tokenAddress,
      symbol: cfg.tokenSymbol,
      decimals: cfg.tokenDecimals,
    },
    contracts: {
      AdapterRegistry: adapterRegistryAddress,
      Bond: bondAddress,
      Escrow: escrowAddress,
      QuittanceRegistry: registryAddress,
      ReputationView: reputationViewAddress,
      OracleAdapter: oracleAdapterAddress,
      TimeoutAdapter: timeoutAdapterAddress,
    },
  };

  const outPath = path.join(__dirname, `../deployments/${networkName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment saved to: deployments/${networkName}.json`);
  console.log("\n── Deployment complete ──\n");
  console.log(JSON.stringify(deployment.contracts, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
