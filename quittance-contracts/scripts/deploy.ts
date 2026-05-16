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
  console.log(`OracleAdapter:       ${oracleAdapterAddress}`);

  // ── 7. TimeoutAdapter ───────────────────────────────────────────────────────
  console.log("Deploying TimeoutAdapter...");
  const TimeoutAdapter = await ethers.getContractFactory("TimeoutAdapter");
  const timeoutAdapter = await TimeoutAdapter.deploy(escrowAddress);
  await timeoutAdapter.waitForDeployment();
  const timeoutAdapterAddress = await timeoutAdapter.getAddress();
  console.log(`TimeoutAdapter:      ${timeoutAdapterAddress}`);

  // ── 8. CosignAdapter (Tier-1) ────────────────────────────────────────────────
  console.log("Deploying CosignAdapter...");
  const CosignAdapter = await ethers.getContractFactory("CosignAdapter");
  const cosignAdapter = await CosignAdapter.deploy();
  await cosignAdapter.waitForDeployment();
  const cosignAdapterAddress = await cosignAdapter.getAddress();
  console.log(`CosignAdapter:       ${cosignAdapterAddress}`);

  // ── 9. ThresholdAdapter (Tier-1, 3-of-5 for PriceFeed) ──────────────────────
  console.log("Deploying ThresholdAdapter (threshold=3)...");
  const ThresholdAdapter = await ethers.getContractFactory("ThresholdAdapter");
  const thresholdAdapter = await ThresholdAdapter.deploy(3); // 3-of-N
  await thresholdAdapter.waitForDeployment();
  const thresholdAdapterAddress = await thresholdAdapter.getAddress();
  console.log(`ThresholdAdapter:    ${thresholdAdapterAddress}`);

  // ── 10. TeeAdapter (Tier-2 honest mock) ──────────────────────────────────────
  console.log("Deploying TeeAdapter (Tier-2 honest mock)...");
  const TeeAdapter = await ethers.getContractFactory("TeeAdapter");
  const teeAdapter = await TeeAdapter.deploy();
  await teeAdapter.waitForDeployment();
  const teeAdapterAddress = await teeAdapter.getAddress();
  console.log(`TeeAdapter:          ${teeAdapterAddress}`);

  // ── 11. ZktlsAdapter (Tier-2 honest mock) ────────────────────────────────────
  console.log("Deploying ZktlsAdapter (Tier-2 honest mock)...");
  const ZktlsAdapter = await ethers.getContractFactory("ZktlsAdapter");
  const zktlsAdapter = await ZktlsAdapter.deploy();
  await zktlsAdapter.waitForDeployment();
  const zktlsAdapterAddress = await zktlsAdapter.getAddress();
  console.log(`ZktlsAdapter:        ${zktlsAdapterAddress}`);

  // ── 12. Forwarder (EIP-712 gasless meta-tx) ───────────────────────────────────
  // relayerFee: ~0.001 settlement units (tuned per network, ≈ gas cost in token)
  const relayerFee = cfg.tokenDecimals === 18
    ? ethers.parseUnits("0.001", 18)   // 0.001 PYUSD on testnet
    : ethers.parseUnits("0.001", 6);   // 0.001 USDC.e on mainnet
  console.log("Deploying Forwarder...");
  const Forwarder = await ethers.getContractFactory("Forwarder");
  const forwarder = await Forwarder.deploy(escrowAddress, tokenAddress, relayerFee);
  await forwarder.waitForDeployment();
  const forwarderAddress = await forwarder.getAddress();
  console.log(`Forwarder:           ${forwarderAddress}`);

  // ── 13. QuittanceEvaluatorHook (ERC-8183) ─────────────────────────────────────
  console.log("Deploying QuittanceEvaluatorHook...");
  const Hook = await ethers.getContractFactory("QuittanceEvaluatorHook");
  const hook = await Hook.deploy(escrowAddress, registryAddress);
  await hook.waitForDeployment();
  const hookAddress = await hook.getAddress();
  console.log(`QuittanceEvalHook:   ${hookAddress}`);

  // ── Post-deploy wiring ──────────────────────────────────────────────────────
  console.log("\nWiring contracts...");

  await (await bond.setEscrow(escrowAddress)).wait();
  console.log("  Bond.setEscrow ✓");

  await (await escrow.setRegistry(registryAddress)).wait();
  console.log("  Escrow.setRegistry ✓");

  // ProofType enum: ORACLE=0, TEE=1, ZKTLS=2, COSIGN=3, THRESHOLD=4, TIMEOUT=5
  await (await adapterRegistry.register(0, oracleAdapterAddress)).wait();
  console.log("  AdapterRegistry: ORACLE registered ✓");

  await (await adapterRegistry.register(1, teeAdapterAddress)).wait();
  console.log("  AdapterRegistry: TEE registered ✓");

  await (await adapterRegistry.register(2, zktlsAdapterAddress)).wait();
  console.log("  AdapterRegistry: ZKTLS registered ✓");

  await (await adapterRegistry.register(3, cosignAdapterAddress)).wait();
  console.log("  AdapterRegistry: COSIGN registered ✓");

  await (await adapterRegistry.register(4, thresholdAdapterAddress)).wait();
  console.log("  AdapterRegistry: THRESHOLD registered ✓");

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

  // Register TEE attestor if provided
  const teeAttestorAddress = process.env.TEE_ATTESTOR_ADDRESS;
  if (teeAttestorAddress) {
    await (await teeAdapter.registerAttestor(teeAttestorAddress)).wait();
    console.log(`  TeeAdapter: attestor ${teeAttestorAddress} registered ✓`);
  } else {
    console.log("  TeeAdapter: no attestor registered (set TEE_ATTESTOR_ADDRESS to register)");
  }

  // Register zkTLS attestor if provided
  const zktlsAttestorAddress = process.env.ZKTLS_ATTESTOR_ADDRESS;
  if (zktlsAttestorAddress) {
    await (await zktlsAdapter.registerAttestor(zktlsAttestorAddress)).wait();
    console.log(`  ZktlsAdapter: attestor ${zktlsAttestorAddress} registered ✓`);
  } else {
    console.log("  ZktlsAdapter: no attestor registered (set ZKTLS_ATTESTOR_ADDRESS to register)");
  }

  // Register threshold attestors if provided (comma-separated list)
  const thresholdAttestors = process.env.THRESHOLD_ATTESTOR_ADDRESSES?.split(",").map(a => a.trim()).filter(Boolean) ?? [];
  for (const addr of thresholdAttestors) {
    await (await thresholdAdapter.addAttestor(addr)).wait();
    console.log(`  ThresholdAdapter: attestor ${addr} registered ✓`);
  }
  if (thresholdAttestors.length === 0) {
    console.log("  ThresholdAdapter: no attestors registered (set THRESHOLD_ATTESTOR_ADDRESSES to register)");
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
      Forwarder: forwarderAddress,
      QuittanceEvaluatorHook: hookAddress,
      OracleAdapter: oracleAdapterAddress,
      TimeoutAdapter: timeoutAdapterAddress,
      CosignAdapter: cosignAdapterAddress,
      ThresholdAdapter: thresholdAdapterAddress,
      TeeAdapter: teeAdapterAddress,
      ZktlsAdapter: zktlsAdapterAddress,
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
