import "dotenv/config";
import { ethers } from "ethers";
import { makeSDK, makeSignFn, AA_SALT } from "../lib/aa";

const DEPLOYER_EOA = "0x311e26702ABa231c321C633d1ff6ecB4445f2308";

async function main() {
  const sdk = makeSDK();
  const key = process.env.SELLER_SMS_PRO_PRIVATE_KEY!;
  const eoa = new ethers.Wallet("0x" + key);

  console.log(`Transferring 0.8 KITE from seller AA → deployer EOA ${DEPLOYER_EOA}`);
  const signFn = makeSignFn(eoa);

  const result = await sdk.sendUserOperationAndWait(
    eoa.address,
    { target: DEPLOYER_EOA, value: ethers.parseEther("0.8"), callData: "0x" },
    signFn,
    AA_SALT,
  );

  console.log("status:", result.status.status);
  console.log("txHash:", result.status.transactionHash);
  console.log("blockNumber:", result.status.blockNumber);
}

main().catch(console.error);
