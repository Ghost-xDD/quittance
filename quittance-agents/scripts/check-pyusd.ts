import "dotenv/config";
import { ethers } from "ethers";

async function main() {
  const p = new ethers.JsonRpcProvider(process.env.KITE_RPC_URL);
  const addr = process.env.PYUSD_ADDRESS!;
  const code = await p.getCode(addr);
  
  // EIP-3009 function selectors
  const selectors: Record<string, string> = {
    "0xe3ee160e": "transferWithAuthorization",
    "0xd9169487": "receiveWithAuthorization",
    "0xeb795549": "cancelAuthorization",
    "0xd505accf": "permit (EIP-2612)",
    "0x7ecebe00": "nonces",
    "0x3644e515": "DOMAIN_SEPARATOR",
  };
  
  console.log("Checking function selectors in PYUSD bytecode:");
  for (const [sel, name] of Object.entries(selectors)) {
    const found = code.includes(sel.slice(2));
    console.log(`  ${found ? "✓" : "✗"} ${sel} ${name}`);
  }
}
main();
