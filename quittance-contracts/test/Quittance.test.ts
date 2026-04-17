import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  MockERC20,
  AdapterRegistry,
  Bond,
  Escrow,
  QuittanceRegistry,
  ReputationView,
  OracleAdapter,
  TimeoutAdapter,
} from "../typechain-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function blockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}

const ProofType = {
  ORACLE: 0,
  TEE: 1,
  ZKTLS: 2,
  COSIGN: 3,
  THRESHOLD: 4,
  TIMEOUT: 5,
} as const;

function makePaymentId(
  buyer: string,
  seller: string,
  amount: bigint,
  deadline: bigint,
  nonce: string
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "uint64", "bytes32"],
      [buyer, seller, amount, deadline, nonce]
    )
  );
}

async function signOracleProof(
  signer: Signer,
  paymentId: string,
  resultHash: string
): Promise<string> {
  const messageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [paymentId, resultHash]
    )
  );
  return signer.signMessage(ethers.getBytes(messageHash));
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Contracts {
  token: MockERC20;
  adapterRegistry: AdapterRegistry;
  bond: Bond;
  escrow: Escrow;
  registry: QuittanceRegistry;
  reputationView: ReputationView;
  oracleAdapter: OracleAdapter;
  timeoutAdapter: TimeoutAdapter;
}

async function deployFixture(): Promise<Contracts> {
  const MIN_BOND = ethers.parseUnits("1", 18);

  const Token = await ethers.getContractFactory("MockERC20");
  const token = (await Token.deploy("Mock PYUSD", "PYUSD", 18)) as MockERC20;

  const AdapterRegistryFactory = await ethers.getContractFactory("AdapterRegistry");
  const adapterRegistry = (await AdapterRegistryFactory.deploy()) as AdapterRegistry;

  const BondFactory = await ethers.getContractFactory("Bond");
  const bond = (await BondFactory.deploy(await token.getAddress(), MIN_BOND)) as Bond;

  const EscrowFactory = await ethers.getContractFactory("Escrow");
  const escrow = (await EscrowFactory.deploy(
    await token.getAddress(),
    await bond.getAddress()
  )) as Escrow;

  const RegistryFactory = await ethers.getContractFactory("QuittanceRegistry");
  const registry = (await RegistryFactory.deploy(
    await adapterRegistry.getAddress(),
    await escrow.getAddress()
  )) as QuittanceRegistry;

  const RepFactory = await ethers.getContractFactory("ReputationView");
  const reputationView = (await RepFactory.deploy(
    await registry.getAddress(),
    await escrow.getAddress(),
    await bond.getAddress()
  )) as ReputationView;

  const OracleFactory = await ethers.getContractFactory("OracleAdapter");
  const oracleAdapter = (await OracleFactory.deploy()) as OracleAdapter;

  const TimeoutFactory = await ethers.getContractFactory("TimeoutAdapter");
  const timeoutAdapter = (await TimeoutFactory.deploy(await escrow.getAddress())) as TimeoutAdapter;

  // Wire
  await bond.setEscrow(await escrow.getAddress());
  await escrow.setRegistry(await registry.getAddress());
  await adapterRegistry.register(ProofType.ORACLE, await oracleAdapter.getAddress());
  await adapterRegistry.register(ProofType.TIMEOUT, await timeoutAdapter.getAddress());

  return { token, adapterRegistry, bond, escrow, registry, reputationView, oracleAdapter, timeoutAdapter };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Quittance Protocol", () => {
  let deployer: Signer;
  let buyer: Signer;
  let seller: Signer;
  let oracle: Signer;
  let contracts: Contracts;

  const AMOUNT = ethers.parseUnits("0.05", 18); // 0.05 PYUSD per request
  const NONCE = ethers.randomBytes(32);
  const REQUEST_HASH = ethers.keccak256(ethers.toUtf8Bytes("GET /sms?to=+44..."));
  const RESULT_HASH = ethers.keccak256(ethers.toUtf8Bytes("SMS delivered: sid_abc123"));

  beforeEach(async () => {
    [deployer, buyer, seller, oracle] = await ethers.getSigners();
    contracts = await deployFixture();

    const { token, bond, oracleAdapter } = contracts;

    // Register oracle attestor
    await oracleAdapter.registerAttestor(await oracle.getAddress());

    // Mint tokens: seller gets MIN_BOND to stake, buyer gets payment amount
    const MIN_BOND = await bond.MIN_BOND();
    await token.mint(await seller.getAddress(), MIN_BOND);
    await token.mint(await buyer.getAddress(), AMOUNT * 10n);

    // Seller stakes bond
    await token.connect(seller).approve(await bond.getAddress(), MIN_BOND);
    await bond.connect(seller).deposit(MIN_BOND);

    // Buyer approves Escrow
    await token
      .connect(buyer)
      .approve(await contracts.escrow.getAddress(), AMOUNT * 10n);
  });

  // ─── Happy path ─────────────────────────────────────────────────────────────

  describe("happy path: open → oracle proof → settle", () => {
    it("transfers funds from buyer to escrow on openEscrow", async () => {
      const { escrow, token } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();

      const deadline = BigInt(await blockTimestamp() + 300);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(NONCE));

      const balBefore = await token.balanceOf(await escrow.getAddress());
      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      expect(await token.balanceOf(await escrow.getAddress())).to.equal(balBefore + AMOUNT);
    });

    it("settles to seller when a valid oracle quittance is posted", async () => {
      const { escrow, registry, token } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();
      const oracleAddr = await oracle.getAddress();

      const deadline = BigInt(await blockTimestamp() + 300);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(NONCE));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      const sig = await signOracleProof(oracle, paymentId, RESULT_HASH);

      const sellerBalBefore = await token.balanceOf(sellerAddr);

      await registry.post({
        paymentId,
        requestHash: REQUEST_HASH,
        resultHash: RESULT_HASH,
        sellerPassport: sellerAddr,
        buyerPassport: buyerAddr,
        proofType: ProofType.ORACLE,
        proofPayload: sig,
        attestor: oracleAddr,
        deliveredAt: 0n,
        deadline,
      });

      expect(await token.balanceOf(sellerAddr)).to.equal(sellerBalBefore + AMOUNT);
    });

    it("marks escrow as settled after posting quittance", async () => {
      const { escrow, registry } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();
      const oracleAddr = await oracle.getAddress();

      const deadline = BigInt(await blockTimestamp() + 300);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(NONCE));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      const sig = await signOracleProof(oracle, paymentId, RESULT_HASH);

      await registry.post({
        paymentId,
        requestHash: REQUEST_HASH,
        resultHash: RESULT_HASH,
        sellerPassport: sellerAddr,
        buyerPassport: buyerAddr,
        proofType: ProofType.ORACLE,
        proofPayload: sig,
        attestor: oracleAddr,
        deliveredAt: 0n,
        deadline,
      });

      const [, , , , settled] = await escrow.getEscrowRecord(paymentId);
      expect(settled).to.be.true;
    });

    it("increments seller successCount and totalVolume", async () => {
      const { escrow, registry } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();
      const oracleAddr = await oracle.getAddress();

      const deadline = BigInt(await blockTimestamp() + 300);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(NONCE));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      await registry.post({
        paymentId,
        requestHash: REQUEST_HASH,
        resultHash: RESULT_HASH,
        sellerPassport: sellerAddr,
        buyerPassport: buyerAddr,
        proofType: ProofType.ORACLE,
        proofPayload: await signOracleProof(oracle, paymentId, RESULT_HASH),
        attestor: oracleAddr,
        deliveredAt: 0n,
        deadline,
      });

      expect(await registry.successCount(sellerAddr)).to.equal(1n);
      expect(await registry.totalVolume(sellerAddr)).to.equal(AMOUNT);
    });
  });

  // ─── Refund + slash path ────────────────────────────────────────────────────

  describe("refund + slash path: open → deadline passes → refund", () => {
    it("refunds buyer and slashes seller bond after deadline", async () => {
      const { escrow, bond, token } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();

      // Use a deadline 1 second in the past (we'll manipulate time)
      const deadline = BigInt(await blockTimestamp() + 2);
      const nonce = ethers.randomBytes(32);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(nonce));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      const sellerBondBefore = await bond.bonds(sellerAddr);
      const buyerBalBefore = await token.balanceOf(buyerAddr);

      // Fast-forward 5 seconds past deadline
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);

      await escrow.connect(buyer).refund(paymentId);

      // Buyer got their tokens back
      expect(await token.balanceOf(buyerAddr)).to.equal(buyerBalBefore + AMOUNT);

      // Seller's bond was slashed by AMOUNT (or their full bond if less)
      const expectedSlash = AMOUNT < sellerBondBefore ? AMOUNT : sellerBondBefore;
      expect(await bond.bonds(sellerAddr)).to.equal(sellerBondBefore - expectedSlash);
    });

    it("increments seller failedCount on refund", async () => {
      const { escrow } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();

      const deadline = BigInt(await blockTimestamp() + 2);
      const nonce = ethers.randomBytes(32);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(nonce));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);

      await escrow.connect(buyer).refund(paymentId);

      expect(await escrow.failedCount(sellerAddr)).to.equal(1n);
    });

    it("cannot refund before deadline", async () => {
      const { escrow } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();

      const deadline = BigInt(await blockTimestamp() + 3600);
      const nonce = ethers.randomBytes(32);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(nonce));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      await expect(escrow.connect(buyer).refund(paymentId)).to.be.revertedWith(
        "Escrow: deadline not passed"
      );
    });

    it("cannot refund if already settled", async () => {
      const { escrow, registry } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();
      const oracleAddr = await oracle.getAddress();

      const deadline = BigInt(await blockTimestamp() + 300);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(NONCE));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      await registry.post({
        paymentId,
        requestHash: REQUEST_HASH,
        resultHash: RESULT_HASH,
        sellerPassport: sellerAddr,
        buyerPassport: buyerAddr,
        proofType: ProofType.ORACLE,
        proofPayload: await signOracleProof(oracle, paymentId, RESULT_HASH),
        attestor: oracleAddr,
        deliveredAt: 0n,
        deadline,
      });

      await ethers.provider.send("evm_increaseTime", [400]);
      await ethers.provider.send("evm_mine", []);

      await expect(escrow.connect(buyer).refund(paymentId)).to.be.revertedWith(
        "Escrow: already resolved"
      );
    });
  });

  // ─── Proof validation ────────────────────────────────────────────────────────

  describe("OracleAdapter: proof validation", () => {
    it("rejects proof from unregistered attestor", async () => {
      const { escrow, registry } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();

      const deadline = BigInt(await blockTimestamp() + 300);
      const nonce = ethers.randomBytes(32);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(nonce));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      // seller signs — not a registered attestor
      const badSig = await signOracleProof(seller, paymentId, RESULT_HASH);

      await expect(
        registry.post({
          paymentId,
          requestHash: REQUEST_HASH,
          resultHash: RESULT_HASH,
          sellerPassport: sellerAddr,
          buyerPassport: buyerAddr,
          proofType: ProofType.ORACLE,
          proofPayload: badSig,
          attestor: sellerAddr, // wrong attestor
          deliveredAt: 0n,
          deadline,
        })
      ).to.be.revertedWith("Registry: proof invalid");
    });

    it("rejects duplicate paymentId", async () => {
      const { escrow, registry } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();
      const oracleAddr = await oracle.getAddress();

      const deadline = BigInt(await blockTimestamp() + 300);
      const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, ethers.hexlify(NONCE));

      await escrow
        .connect(buyer)
        .openEscrow(paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE);

      const q = {
        paymentId,
        requestHash: REQUEST_HASH,
        resultHash: RESULT_HASH,
        sellerPassport: sellerAddr,
        buyerPassport: buyerAddr,
        proofType: ProofType.ORACLE,
        proofPayload: await signOracleProof(oracle, paymentId, RESULT_HASH),
        attestor: oracleAddr,
        deliveredAt: 0n,
        deadline,
      };

      await registry.post(q);

      // Mint more tokens so buyer can try again
      const { token } = contracts;
      await token.mint(buyerAddr, AMOUNT);

      await expect(registry.post(q)).to.be.revertedWith("Registry: quittance already posted");
    });
  });

  // ─── Bond ────────────────────────────────────────────────────────────────────

  describe("Bond: cooldown withdrawal", () => {
    it("blocks withdrawal during cooldown", async () => {
      const { bond } = contracts;
      const MIN_BOND = await bond.MIN_BOND();

      await bond.connect(seller).requestWithdraw(MIN_BOND);

      await expect(bond.connect(seller).withdraw()).to.be.revertedWith("Bond: cooldown active");
    });

    it("allows withdrawal after cooldown", async () => {
      const { bond, token } = contracts;
      const MIN_BOND = await bond.MIN_BOND();
      const sellerAddr = await seller.getAddress();

      await bond.connect(seller).requestWithdraw(MIN_BOND);

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);

      const balBefore = await token.balanceOf(sellerAddr);
      await bond.connect(seller).withdraw();
      expect(await token.balanceOf(sellerAddr)).to.equal(balBefore + MIN_BOND);
    });
  });

  // ─── ReputationView ──────────────────────────────────────────────────────────

  describe("ReputationView", () => {
    it("returns 10000 bps success rate for a fresh seller", async () => {
      const { reputationView } = contracts;
      const sellerAddr = await seller.getAddress();
      expect(await reputationView.successRate(sellerAddr)).to.equal(10_000n);
    });

    it("calculates correct success rate after one success and one failure", async () => {
      const { escrow, registry, reputationView, token } = contracts;
      const buyerAddr = await buyer.getAddress();
      const sellerAddr = await seller.getAddress();
      const oracleAddr = await oracle.getAddress();

      // First tx: success
      const deadline1 = BigInt(await blockTimestamp() + 300);
      const nonce1 = ethers.randomBytes(32);
      const pid1 = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline1, ethers.hexlify(nonce1));
      await escrow.connect(buyer).openEscrow(pid1, buyerAddr, sellerAddr, AMOUNT, deadline1, ProofType.ORACLE);
      await registry.post({
        paymentId: pid1, requestHash: REQUEST_HASH, resultHash: RESULT_HASH,
        sellerPassport: sellerAddr, buyerPassport: buyerAddr, proofType: ProofType.ORACLE,
        proofPayload: await signOracleProof(oracle, pid1, RESULT_HASH),
        attestor: oracleAddr, deliveredAt: 0n, deadline: deadline1,
      });

      // Second tx: fail (deadline passes, buyer refunds)
      await token.mint(buyerAddr, AMOUNT);
      const deadline2 = BigInt(await blockTimestamp() + 2);
      const nonce2 = ethers.randomBytes(32);
      const pid2 = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline2, ethers.hexlify(nonce2));
      await escrow.connect(buyer).openEscrow(pid2, buyerAddr, sellerAddr, AMOUNT, deadline2, ProofType.ORACLE);
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);
      await escrow.connect(buyer).refund(pid2);

      // 1 success, 1 fail → 50%
      expect(await reputationView.successRate(sellerAddr)).to.equal(5_000n);
    });
  });
});
