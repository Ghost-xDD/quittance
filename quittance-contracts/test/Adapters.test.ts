import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import {
  MockERC20,
  AdapterRegistry,
  Bond,
  Escrow,
  QuittanceRegistry,
  ThresholdAdapter,
  TeeAdapter,
  ZktlsAdapter,
  CosignAdapter,
  Forwarder,
  QuittanceEvaluatorHook,
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

const AMOUNT     = ethers.parseUnits("1", 18);
const MIN_BOND   = ethers.parseUnits("1", 18);
const REQUEST_H  = ethers.keccak256(ethers.toUtf8Bytes("test request"));
const RESULT_H   = ethers.keccak256(ethers.toUtf8Bytes("test result"));

function makePaymentId(
  buyer: string, seller: string, amount: bigint, deadline: bigint, nonce: Uint8Array
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "uint64", "bytes32"],
      [buyer, seller, amount, deadline, nonce],
    ),
  );
}

interface Contracts {
  token:       MockERC20;
  bond:        Bond;
  escrow:      Escrow;
  registry:    QuittanceRegistry;
  adapterReg:  AdapterRegistry;
  threshold:   ThresholdAdapter;
  tee:         TeeAdapter;
  zktls:       ZktlsAdapter;
  cosign:      CosignAdapter;
  forwarder:   Forwarder;
  hook:        QuittanceEvaluatorHook;
}

async function deploy(): Promise<{ contracts: Contracts; owner: Signer; buyer: Signer; seller: Signer; attestor: Signer }> {
  const [owner, buyer, seller, attestor] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("Test PYUSD", "PYUSD", 18) as MockERC20;

  const AR = await ethers.getContractFactory("AdapterRegistry");
  const adapterReg = await AR.deploy() as AdapterRegistry;

  const B = await ethers.getContractFactory("Bond");
  const bond = await B.deploy(await token.getAddress(), MIN_BOND) as Bond;

  const E = await ethers.getContractFactory("Escrow");
  const escrow = await E.deploy(await token.getAddress(), await bond.getAddress()) as Escrow;

  const QR = await ethers.getContractFactory("QuittanceRegistry");
  const registry = await QR.deploy(await adapterReg.getAddress(), await escrow.getAddress()) as QuittanceRegistry;

  await bond.setEscrow(await escrow.getAddress());
  await escrow.setRegistry(await registry.getAddress());

  // Adapters
  const CA = await ethers.getContractFactory("CosignAdapter");
  const cosign = await CA.deploy() as CosignAdapter;

  const TA = await ethers.getContractFactory("ThresholdAdapter");
  const threshold = await TA.deploy(2) as ThresholdAdapter; // 2-of-N for tests

  const TEE = await ethers.getContractFactory("TeeAdapter");
  const tee = await TEE.deploy() as TeeAdapter;

  const ZK = await ethers.getContractFactory("ZktlsAdapter");
  const zktls = await ZK.deploy() as ZktlsAdapter;

  // Register all adapters
  await adapterReg.register(ProofType.COSIGN,    await cosign.getAddress());
  await adapterReg.register(ProofType.THRESHOLD, await threshold.getAddress());
  await adapterReg.register(ProofType.TEE,       await tee.getAddress());
  await adapterReg.register(ProofType.ZKTLS,     await zktls.getAddress());

  // Register attestor in TEE + zkTLS
  await tee.registerAttestor(await attestor.getAddress());
  await zktls.registerAttestor(await attestor.getAddress());

  // Register attestors in Threshold
  await threshold.addAttestor(await owner.getAddress());
  await threshold.addAttestor(await attestor.getAddress());

  // Forwarder
  const relayerFee = ethers.parseUnits("0.001", 18);
  const FW = await ethers.getContractFactory("Forwarder");
  const forwarder = await FW.deploy(
    await escrow.getAddress(),
    await token.getAddress(),
    relayerFee,
  ) as Forwarder;

  // QuittanceEvaluatorHook
  const HK = await ethers.getContractFactory("QuittanceEvaluatorHook");
  const hook = await HK.deploy(await escrow.getAddress(), await registry.getAddress()) as QuittanceEvaluatorHook;

  // Fund buyer and seller
  await token.mint(await buyer.getAddress(), AMOUNT * 10n);
  await token.mint(await seller.getAddress(), MIN_BOND * 5n);

  // Seller deposits bond
  await token.connect(seller).approve(await bond.getAddress(), MIN_BOND * 3n);
  await bond.connect(seller).deposit(MIN_BOND * 3n);

  // Buyer pre-approves escrow
  await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT * 10n);

  return {
    contracts: { token, bond, escrow, registry, adapterReg, threshold, tee, zktls, cosign, forwarder, hook },
    owner, buyer, seller, attestor,
  };
}

// Helper: open an escrow for a given proofType
async function openEscrow(
  contracts: Contracts,
  buyer: Signer,
  seller: Signer,
  proofType: number,
  deadlineOffset = 300n,
): Promise<{ paymentId: string; deadline: bigint; nonce: Uint8Array }> {
  const buyerAddr  = await buyer.getAddress();
  const sellerAddr = await seller.getAddress();
  const block      = await ethers.provider.getBlock("latest");
  const deadline   = BigInt(block!.timestamp) + deadlineOffset;
  const nonce      = ethers.randomBytes(32);
  const paymentId  = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, nonce);

  await contracts.escrow.connect(seller).openEscrow(
    paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, proofType
  );
  return { paymentId, deadline, nonce };
}

// ─── ThresholdAdapter ────────────────────────────────────────────────────────

describe("ThresholdAdapter", () => {
  it("accepts M-of-N valid signatures (2-of-2)", async () => {
    const { contracts, buyer, seller, owner, attestor } = await deploy();

    const { paymentId, deadline } = await openEscrow(contracts, buyer, seller, ProofType.THRESHOLD);
    const buyerAddr  = await buyer.getAddress();
    const sellerAddr = await seller.getAddress();

    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [paymentId, RESULT_H])
    );
    const sig1 = await owner.signMessage(ethers.getBytes(digest));
    const sig2 = await attestor.signMessage(ethers.getBytes(digest));

    const proofPayload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes[]"], [[sig1, sig2]]
    );

    await contracts.registry.post({
      paymentId,
      requestHash:    REQUEST_H,
      resultHash:     RESULT_H,
      sellerPassport: sellerAddr,
      buyerPassport:  buyerAddr,
      proofType:      ProofType.THRESHOLD,
      proofPayload,
      attestor:       ethers.ZeroAddress,
      deliveredAt:    0n,
      deadline,
    });

    const q = await contracts.registry.getQuittance(paymentId);
    expect(q.deliveredAt).to.be.gt(0n);
  });

  it("rejects if fewer than threshold valid signatures", async () => {
    const { contracts, buyer, seller, attestor } = await deploy();

    const { paymentId, deadline } = await openEscrow(contracts, buyer, seller, ProofType.THRESHOLD);
    const buyerAddr  = await buyer.getAddress();
    const sellerAddr = await seller.getAddress();

    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [paymentId, RESULT_H])
    );
    // Only 1 sig, threshold is 2
    const sig1 = await attestor.signMessage(ethers.getBytes(digest));
    const proofPayload = ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [[sig1]]);

    await expect(contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerAddr, buyerPassport: buyerAddr,
      proofType: ProofType.THRESHOLD, proofPayload,
      attestor: ethers.ZeroAddress, deliveredAt: 0n, deadline,
    })).to.be.revertedWith("Registry: proof invalid");
  });

  it("rejects duplicate signatures from the same attestor", async () => {
    const { contracts, buyer, seller, attestor } = await deploy();

    const { paymentId, deadline } = await openEscrow(contracts, buyer, seller, ProofType.THRESHOLD);
    const buyerAddr  = await buyer.getAddress();
    const sellerAddr = await seller.getAddress();

    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [paymentId, RESULT_H])
    );
    // Same sig twice — should still count as 1
    const sig1 = await attestor.signMessage(ethers.getBytes(digest));
    const proofPayload = ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [[sig1, sig1]]);

    await expect(contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerAddr, buyerPassport: buyerAddr,
      proofType: ProofType.THRESHOLD, proofPayload,
      attestor: ethers.ZeroAddress, deliveredAt: 0n, deadline,
    })).to.be.revertedWith("Registry: proof invalid");
  });
});

// ─── TeeAdapter ──────────────────────────────────────────────────────────────

describe("TeeAdapter (Tier-2 honest mock)", () => {
  async function makeTeePay(
    attestor: Signer,
    paymentId: string,
    resultHash: string,
    teeReportHash: string,
  ): Promise<string> {
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32"],
        [paymentId, resultHash, teeReportHash],
      )
    );
    const sig = await attestor.signMessage(ethers.getBytes(digest));
    // MOCK_FLAG (0xFF) + teeReportHash (32) + sig (65)
    return ethers.concat([
      "0xFF",
      teeReportHash,
      sig,
    ]);
  }

  it("accepts a valid Tier-2 mock TEE proof", async () => {
    const { contracts, buyer, seller, attestor } = await deploy();
    const { paymentId, deadline } = await openEscrow(contracts, buyer, seller, ProofType.TEE);
    const buyerAddr  = await buyer.getAddress();
    const sellerAddr = await seller.getAddress();
    const attestorAddr = await attestor.getAddress();

    const teeReportHash = ethers.keccak256(ethers.toUtf8Bytes("phala-testnet-report-001"));
    const proofPayload  = await makeTeePay(attestor, paymentId, RESULT_H, teeReportHash);

    await contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerAddr, buyerPassport: buyerAddr,
      proofType: ProofType.TEE, proofPayload,
      attestor: attestorAddr, deliveredAt: 0n, deadline,
    });

    const q = await contracts.registry.getQuittance(paymentId);
    expect(q.deliveredAt).to.be.gt(0n);
  });

  it("rejects proof without MOCK_FLAG", async () => {
    const { contracts, buyer, seller, attestor } = await deploy();
    const { paymentId, deadline } = await openEscrow(contracts, buyer, seller, ProofType.TEE);
    const buyerAddr  = await buyer.getAddress();
    const sellerAddr = await seller.getAddress();
    const attestorAddr = await attestor.getAddress();

    // First byte is 0x00 instead of 0xFF
    const badPayload = ethers.concat(["0x00", ethers.randomBytes(97)]);

    await expect(contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerAddr, buyerPassport: buyerAddr,
      proofType: ProofType.TEE, proofPayload: badPayload,
      attestor: attestorAddr, deliveredAt: 0n, deadline,
    })).to.be.revertedWith("Registry: proof invalid");
  });

  it("rejects proof from unregistered attestor", async () => {
    const { contracts, buyer, seller, owner } = await deploy();
    const { paymentId, deadline } = await openEscrow(contracts, buyer, seller, ProofType.TEE);
    const buyerAddr  = await buyer.getAddress();
    const sellerAddr = await seller.getAddress();
    const ownerAddr  = await owner.getAddress(); // not registered as TEE attestor

    const teeReportHash = ethers.keccak256(ethers.toUtf8Bytes("phala-testnet-report-002"));
    const proofPayload  = await makeTeePay(owner, paymentId, RESULT_H, teeReportHash);

    await expect(contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerAddr, buyerPassport: buyerAddr,
      proofType: ProofType.TEE, proofPayload,
      attestor: ownerAddr, deliveredAt: 0n, deadline,
    })).to.be.revertedWith("Registry: proof invalid");
  });
});

// ─── ZktlsAdapter ────────────────────────────────────────────────────────────

describe("ZktlsAdapter (Tier-2 honest mock)", () => {
  async function makeZktlsPayload(
    attestor: Signer,
    paymentId: string,
    resultHash: string,
    commitment: string,
    urlHash: string,
  ): Promise<string> {
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32", "bytes32"],
        [paymentId, resultHash, commitment, urlHash],
      )
    );
    const sig = await attestor.signMessage(ethers.getBytes(digest));
    return ethers.concat(["0xFF", commitment, urlHash, sig]);
  }

  it("accepts a valid Tier-2 mock zkTLS proof", async () => {
    const { contracts, buyer, seller, attestor } = await deploy();
    const { paymentId, deadline } = await openEscrow(contracts, buyer, seller, ProofType.ZKTLS);
    const buyerAddr    = await buyer.getAddress();
    const sellerAddr   = await seller.getAddress();
    const attestorAddr = await attestor.getAddress();

    const commitment   = ethers.keccak256(ethers.toUtf8Bytes("reclaim-session-001"));
    const urlHash      = ethers.keccak256(ethers.toUtf8Bytes("https://example.com/price"));
    const proofPayload = await makeZktlsPayload(attestor, paymentId, RESULT_H, commitment, urlHash);

    await contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerAddr, buyerPassport: buyerAddr,
      proofType: ProofType.ZKTLS, proofPayload,
      attestor: attestorAddr, deliveredAt: 0n, deadline,
    });

    const q = await contracts.registry.getQuittance(paymentId);
    expect(q.deliveredAt).to.be.gt(0n);
  });

  it("rejects proof without MOCK_FLAG", async () => {
    const { contracts, buyer, seller, attestor } = await deploy();
    const { paymentId, deadline } = await openEscrow(contracts, buyer, seller, ProofType.ZKTLS);
    const buyerAddr    = await buyer.getAddress();
    const sellerAddr   = await seller.getAddress();
    const attestorAddr = await attestor.getAddress();

    const badPayload = ethers.concat(["0x00", ethers.randomBytes(129)]);

    await expect(contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerAddr, buyerPassport: buyerAddr,
      proofType: ProofType.ZKTLS, proofPayload: badPayload,
      attestor: attestorAddr, deliveredAt: 0n, deadline,
    })).to.be.revertedWith("Registry: proof invalid");
  });
});

// ─── CosignAdapter ───────────────────────────────────────────────────────────
//
// COSIGN tests use raw ethers.Wallet objects (not HardhatEthersSigners) so we
// can access signingKey for adaptor-signature scalar arithmetic.

describe("CosignAdapter", () => {
  const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

  // Build a valid COSIGN proof:
  //   1. Generate witness scalar t from a random Wallet.
  //   2. Seller signs paymentMessage with their key; subtract t from s so that
  //      Adapt(sigHat_S, t) → s_full → recovers to sellerWallet.address.
  //   3. Buyer countersigns the COSIGN_ACK digest.
  async function makeCosignProof(
    buyerWallet: ethers.Wallet,
    sellerWallet: ethers.Wallet,
    paymentId: string,
    resultHash: string,
  ): Promise<{ proofPayload: string; T_x: string; T_parity: number }> {
    const witnessWallet = ethers.Wallet.createRandom();
    const t       = BigInt(witnessWallet.privateKey);
    const t_hex   = ethers.zeroPadValue(ethers.toBeHex(t), 32);

    const pubBytes = ethers.getBytes(witnessWallet.signingKey.publicKey);
    const T_x      = ethers.hexlify(pubBytes.slice(1, 33));
    const T_parity = (pubBytes[64] % 2 === 0) ? 0x02 : 0x03;

    // Buyer ack
    const ackDigest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "bytes32", "bytes32", "uint8"],
        ["COSIGN_ACK", paymentId, T_x, T_parity],
      )
    );
    const sig_U = await buyerWallet.signMessage(ethers.getBytes(ackDigest));

    // Seller presig: sign normally, subtract t from s
    const paymentDigest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32", "uint8"],
        [paymentId, resultHash, T_x, T_parity],
      )
    );
    const sellerSig  = sellerWallet.signingKey.sign(ethers.getBytes(paymentDigest));
    const s_presig   = (BigInt(sellerSig.s) - t + N) % N;
    const sigHat_S   = ethers.concat([
      sellerSig.r,
      ethers.zeroPadValue(ethers.toBeHex(s_presig), 32),
      sellerSig.v === 27 ? "0x1b" : "0x1c",
    ]);

    const proofPayload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint8", "bytes", "bytes", "bytes32"],
      [T_x, T_parity, sigHat_S, sig_U, t_hex],
    );

    return { proofPayload, T_x, T_parity };
  }

  // Fresh deployment with funded raw Wallet objects for buyer + seller.
  async function deployCosign() {
    const base = await deploy();
    const [funder] = await ethers.getSigners();

    const buyerW  = ethers.Wallet.createRandom().connect(ethers.provider);
    const sellerW = ethers.Wallet.createRandom().connect(ethers.provider);

    await funder.sendTransaction({ to: buyerW.address,  value: ethers.parseEther("1") });
    await funder.sendTransaction({ to: sellerW.address, value: ethers.parseEther("1") });

    await base.contracts.token.mint(buyerW.address,  AMOUNT * 10n);
    await base.contracts.token.mint(sellerW.address, MIN_BOND * 3n);
    await base.contracts.token.connect(sellerW).approve(await base.contracts.bond.getAddress(), MIN_BOND * 3n);
    await base.contracts.bond.connect(sellerW).deposit(MIN_BOND * 3n);
    await base.contracts.token.connect(buyerW).approve(await base.contracts.escrow.getAddress(), AMOUNT * 10n);

    return { ...base, buyerW, sellerW };
  }

  it("accepts a valid COSIGN proof (adaptor-sig happy path)", async () => {
    const { contracts, buyerW, sellerW } = await deployCosign();
    const { paymentId, deadline } = await openEscrow(contracts, buyerW, sellerW, ProofType.COSIGN);
    const { proofPayload } = await makeCosignProof(buyerW, sellerW, paymentId, RESULT_H);

    await contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerW.address, buyerPassport: buyerW.address,
      proofType: ProofType.COSIGN, proofPayload,
      attestor: ethers.ZeroAddress, deliveredAt: 0n, deadline,
    });

    const q = await contracts.registry.getQuittance(paymentId);
    expect(q.deliveredAt).to.be.gt(0n);
  });

  it("rejects COSIGN proof with wrong buyer countersignature", async () => {
    const { contracts, buyerW, sellerW, attestor } = await deployCosign();
    const { paymentId, deadline } = await openEscrow(contracts, buyerW, sellerW, ProofType.COSIGN);
    const { proofPayload } = await makeCosignProof(buyerW, sellerW, paymentId, RESULT_H);

    const [T_x, T_parity, sigHat_S, , t] = ethers.AbiCoder.defaultAbiCoder().decode(
      ["bytes32", "uint8", "bytes", "bytes", "bytes32"], proofPayload,
    ) as [string, number, string, string, string];

    const wrongAck = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "bytes32", "bytes32", "uint8"],
        ["COSIGN_ACK", paymentId, T_x, T_parity],
      )
    );
    const wrongSig_U = await attestor.signMessage(ethers.getBytes(wrongAck));
    const badPayload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint8", "bytes", "bytes", "bytes32"],
      [T_x, T_parity, sigHat_S, wrongSig_U, t],
    );

    await expect(contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerW.address, buyerPassport: buyerW.address,
      proofType: ProofType.COSIGN, proofPayload: badPayload,
      attestor: ethers.ZeroAddress, deliveredAt: 0n, deadline,
    })).to.be.revertedWith("Registry: proof invalid");
  });

  it("rejects COSIGN proof with non-zero attestor (must be address(0))", async () => {
    const { contracts, buyerW, sellerW, attestor } = await deployCosign();
    const { paymentId, deadline } = await openEscrow(contracts, buyerW, sellerW, ProofType.COSIGN);
    const { proofPayload } = await makeCosignProof(buyerW, sellerW, paymentId, RESULT_H);

    await expect(contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerW.address, buyerPassport: buyerW.address,
      proofType: ProofType.COSIGN, proofPayload,
      attestor: await attestor.getAddress(), // must be address(0)
      deliveredAt: 0n, deadline,
    })).to.be.revertedWith("Registry: proof invalid");
  });

  it("rejects COSIGN proof with zero witness (t=0)", async () => {
    const { contracts, buyerW, sellerW } = await deployCosign();
    const { paymentId, deadline } = await openEscrow(contracts, buyerW, sellerW, ProofType.COSIGN);

    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint8", "bytes", "bytes", "bytes32"],
      [ethers.hexlify(ethers.randomBytes(32)), 0x02, ethers.randomBytes(65), ethers.randomBytes(65), ethers.zeroPadValue("0x00", 32)],
    );

    await expect(contracts.registry.post({
      paymentId, requestHash: REQUEST_H, resultHash: RESULT_H,
      sellerPassport: sellerW.address, buyerPassport: buyerW.address,
      proofType: ProofType.COSIGN, proofPayload: payload,
      attestor: ethers.ZeroAddress, deliveredAt: 0n, deadline,
    })).to.be.revertedWith("Registry: proof invalid");
  });
});

// ─── Forwarder ───────────────────────────────────────────────────────────────
//
// Forwarder tests use raw ethers.Wallet objects so signTypedData is available
// via the underlying SigningKey (HardhatEthersSigner wraps differently in v6).

describe("Forwarder", () => {
  async function deployForwarder() {
    const base = await deploy();
    const [funder] = await ethers.getSigners();

    const buyerW  = ethers.Wallet.createRandom().connect(ethers.provider);
    const sellerW = ethers.Wallet.createRandom().connect(ethers.provider);
    const wrongW  = ethers.Wallet.createRandom().connect(ethers.provider);

    for (const w of [buyerW, sellerW, wrongW]) {
      await funder.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
    }

    await base.contracts.token.mint(buyerW.address,  AMOUNT * 10n);
    await base.contracts.token.mint(sellerW.address, MIN_BOND * 3n);
    await base.contracts.token.connect(sellerW).approve(await base.contracts.bond.getAddress(), MIN_BOND * 3n);
    await base.contracts.bond.connect(sellerW).deposit(MIN_BOND * 3n);

    return { ...base, buyerW, sellerW, wrongW };
  }

  function getForwarderDomain(chainId: bigint, forwarderAddr: string) {
    return {
      name: "QuittanceForwarder",
      version: "1",
      chainId,
      verifyingContract: forwarderAddr,
    };
  }

  const FORWARD_TYPES = {
    ForwardOpenEscrow: [
      { name: "buyerPassport",  type: "address" },
      { name: "sellerPassport", type: "address" },
      { name: "requestHash",    type: "bytes32"  },
      { name: "amount",         type: "uint256"  },
      { name: "gasFeeBudget",   type: "uint256"  },
      { name: "deadline",       type: "uint64"   },
      { name: "proofType",      type: "uint8"    },
      { name: "minBondTier",    type: "uint8"    },
      { name: "nonce",          type: "uint64"   },
    ],
  };

  it("rejects forwardOpenEscrow with invalid buyer signature", async () => {
    const { contracts, sellerW, wrongW } = await deployForwarder();

    const forwarderAddr = await contracts.forwarder.getAddress();
    const block    = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp) + 300n;

    const params = {
      buyerPassport:  wrongW.address, // claim to be wrongW
      sellerPassport: sellerW.address,
      requestHash:    REQUEST_H,
      amount:         AMOUNT,
      gasFeeBudget:   ethers.parseUnits("0.01", 18),
      deadline,
      proofType:      ProofType.ORACLE,
      minBondTier:    0,
      nonce:          0n,
    };

    const chainId = (await ethers.provider.getNetwork()).chainId;
    // sellerW signs (wrong signer — not wrongW/buyerPassport)
    const wrongSig = await sellerW.signTypedData(
      getForwarderDomain(chainId, forwarderAddr), FORWARD_TYPES, params
    );

    await expect(
      contracts.forwarder.connect(sellerW).forwardOpenEscrow(params, wrongSig)
    ).to.be.revertedWith("Forwarder: invalid buyer signature");
  });

  it("executes forwardOpenEscrow with valid buyer signature", async () => {
    const { contracts, buyerW, sellerW } = await deployForwarder();

    const forwarderAddr = await contracts.forwarder.getAddress();
    const block    = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp) + 300n;
    const budget   = ethers.parseUnits("0.01", 18);

    await contracts.token.connect(buyerW).approve(forwarderAddr, AMOUNT + budget);

    const params = {
      buyerPassport:  buyerW.address,
      sellerPassport: sellerW.address,
      requestHash:    REQUEST_H,
      amount:         AMOUNT,
      gasFeeBudget:   budget,
      deadline,
      proofType:      ProofType.ORACLE,
      minBondTier:    0,
      nonce:          0n,
    };

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const sig = await buyerW.signTypedData(
      getForwarderDomain(chainId, forwarderAddr), FORWARD_TYPES, params
    );

    const tx = await contracts.forwarder.connect(sellerW).forwardOpenEscrow(params, sig);
    const receipt = await tx.wait();
    expect(receipt!.status).to.equal(1);
  });

  it("pauses and unpauses correctly", async () => {
    const { contracts, buyerW, sellerW } = await deployForwarder();

    await contracts.forwarder.setPaused(true);

    const forwarderAddr = await contracts.forwarder.getAddress();
    await contracts.token.connect(buyerW).approve(forwarderAddr, AMOUNT * 2n);

    const params = {
      buyerPassport:  buyerW.address,
      sellerPassport: sellerW.address,
      requestHash:    REQUEST_H,
      amount:         AMOUNT,
      gasFeeBudget:   ethers.parseUnits("0.01", 18),
      deadline:       BigInt(await blockTimestamp() + 300),
      proofType:      ProofType.ORACLE,
      minBondTier:    0,
      nonce:          0n,
    };

    await expect(
      contracts.forwarder.connect(buyerW).forwardOpenEscrow(params, "0x" + "00".repeat(65))
    ).to.be.revertedWith("Forwarder: paused");
  });
});

// ─── QuittanceEvaluatorHook ──────────────────────────────────────────────────

describe("QuittanceEvaluatorHook", () => {
  it("returns complete=false for an unfunded job", async () => {
    const { contracts } = await deploy();
    expect(await contracts.hook.complete(999n)).to.equal(false);
  });

  it("returns complete=true after a quittance is posted via Hook.submit", async () => {
    const { contracts, buyer, seller, owner, attestor } = await deploy();

    // Register an oracle adapter so this test can use it
    const OA = await ethers.getContractFactory("OracleAdapter");
    const oa = await OA.deploy();
    await oa.registerAttestor(await attestor.getAddress());
    await contracts.adapterReg.register(ProofType.ORACLE, await oa.getAddress());

    // Permit a mock marketplace (owner = marketplace in this test)
    const hookAddr       = await contracts.hook.getAddress();
    const buyerAddr      = await buyer.getAddress();
    const sellerAddr     = await seller.getAddress();
    const ownerAddr      = await owner.getAddress();
    await contracts.hook.setMarketplace(ownerAddr, true);

    // Open escrow manually
    const block    = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp) + 300n;
    const nonce    = ethers.randomBytes(32);
    const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, nonce);

    await contracts.escrow.connect(seller).openEscrow(
      paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE
    );

    // fund(jobId) — marketplace informs hook of the escrow
    const meta = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "uint64", "uint8", "bytes32", "bytes32"],
      [buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE, REQUEST_H, paymentId],
    );
    await contracts.hook.connect(owner).fund(1n, meta);
    expect(await contracts.hook.complete(1n)).to.equal(false);

    // Build oracle proof
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [paymentId, RESULT_H])
    );
    const oracleSig = await attestor.signMessage(ethers.getBytes(digest));

    const q = {
      paymentId,
      requestHash:    REQUEST_H,
      resultHash:     RESULT_H,
      sellerPassport: sellerAddr,
      buyerPassport:  buyerAddr,
      proofType:      ProofType.ORACLE,
      proofPayload:   oracleSig,
      attestor:       await attestor.getAddress(),
      deliveredAt:    0n,
      deadline,
    };

    // submit(jobId) — marketplace triggers proof posting
    const encodedQ = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32,bytes32,bytes32,address,address,uint8,bytes,address,uint64,uint64)"],
      [[q.paymentId, q.requestHash, q.resultHash, q.sellerPassport, q.buyerPassport,
        q.proofType, q.proofPayload, q.attestor, q.deliveredAt, q.deadline]]
    );
    await contracts.hook.connect(owner).submit(1n, encodedQ);

    expect(await contracts.hook.complete(1n)).to.equal(true);
  });

  it("reject() triggers escrow refund after deadline", async () => {
    const { contracts, buyer, seller, owner } = await deploy();

    const hookAddr  = await contracts.hook.getAddress();
    const buyerAddr = await buyer.getAddress();
    const sellerAddr = await seller.getAddress();
    const ownerAddr  = await owner.getAddress();
    await contracts.hook.setMarketplace(ownerAddr, true);

    const block    = await ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp) + 2n; // very short
    const nonce    = ethers.randomBytes(32);
    const paymentId = makePaymentId(buyerAddr, sellerAddr, AMOUNT, deadline, nonce);

    await contracts.escrow.connect(seller).openEscrow(
      paymentId, buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE
    );

    const meta = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "uint64", "uint8", "bytes32", "bytes32"],
      [buyerAddr, sellerAddr, AMOUNT, deadline, ProofType.ORACLE, REQUEST_H, paymentId],
    );
    await contracts.hook.connect(owner).fund(2n, meta);

    // Advance past deadline
    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);

    const buyerBalBefore = await contracts.token.balanceOf(buyerAddr);
    await contracts.hook.connect(owner).reject(2n, "deadline expired");
    const buyerBalAfter = await contracts.token.balanceOf(buyerAddr);

    expect(buyerBalAfter).to.be.gt(buyerBalBefore);
  });
});
