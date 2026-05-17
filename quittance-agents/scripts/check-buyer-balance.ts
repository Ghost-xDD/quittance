import 'dotenv/config';
import { ethers } from 'ethers';
import { makeSDK, aaAddress } from '../lib/aa';

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.KITE_RPC_URL);
  const buyerKey = process.env.BUYER_PRIVATE_KEY as string;
  const sellerKey = process.env.SELLER_EMAIL_PRIVATE_KEY as string;
  const buyerEOA = new ethers.Wallet(buyerKey, provider);
  const sellerEOA = new ethers.Wallet(sellerKey, provider);
  const sdk = makeSDK();
  const buyerAA  = aaAddress(sdk, buyerEOA.address);
  const sellerAA = aaAddress(sdk, sellerEOA.address);

  const usdc = new ethers.Contract(
    process.env.USDC_ADDRESS as string,
    ['function balanceOf(address) view returns (uint256)',
     'function allowance(address,address) view returns (uint256)'],
    provider,
  );

  const [buyerBal, buyerAllowance, sellerBal,
         buyerNative, sellerNative, sellerEOANative] = await Promise.all([
    usdc.balanceOf(buyerAA),
    usdc.allowance(buyerAA, process.env.ESCROW_ADDRESS as string),
    usdc.balanceOf(sellerAA),
    provider.getBalance(buyerAA),
    provider.getBalance(sellerAA),
    provider.getBalance(sellerEOA.address),
  ]);

  const f = (v: bigint, d = 6) => ethers.formatUnits(v as bigint, d);
  const fe = (v: bigint) => ethers.formatEther(v as bigint);

  console.log('=== Buyer AA', buyerAA, '===');
  console.log('  USDC balance:    ', f(buyerBal as bigint));
  console.log('  Escrow allowance:', f(buyerAllowance as bigint));
  console.log('  Native (KITE):   ', fe(buyerNative as bigint));
  console.log('');
  console.log('=== Seller AA', sellerAA, '(email.kite) ===');
  console.log('  USDC balance:    ', f(sellerBal as bigint));
  console.log('  Native (KITE):   ', fe(sellerNative as bigint));
  console.log('');
  console.log('=== Seller EOA', sellerEOA.address, '===');
  console.log('  Native (KITE):   ', fe(sellerEOANative as bigint));
}

main().catch(console.error);

