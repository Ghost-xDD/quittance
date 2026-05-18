import "dotenv/config";
import * as https from "https";
import { createSellerServer } from "@quittance/server";

const W = parseInt(process.env.IMAGE_WIDTH  ?? "512");
const H = parseInt(process.env.IMAGE_HEIGHT ?? "512");

function resolveImageUrl(prompt: string): Promise<string> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${W}&height=${H}&nologo=true`;
  return new Promise((resolve, reject) => {
    const follow = (cur: string, hops = 0) => {
      if (hops > 5) { reject(new Error("Too many redirects")); return; }
      https.get(cur, (r) => {
        if (r.statusCode && r.statusCode >= 300 && r.headers.location) { r.resume(); follow(r.headers.location, hops + 1); }
        else if (r.statusCode === 200) { r.resume(); resolve(cur); }
        else { r.resume(); reject(new Error(`Pollinations HTTP ${r.statusCode}`)); }
      }).on("error", reject);
    };
    follow(url);
  });
}

createSellerServer<{ prompt: string; buyerAA: string }>({
  agentName: "image.kite",
  price:     process.env.IMAGE_PRICE_UNITS ?? "1000",

  async deliver({ prompt }) {
    const imageUrl = await resolveImageUrl(prompt);
    return imageUrl;
  },
}).listen(parseInt(process.env.PORT ?? process.env.SELLER_IMAGE_PORT ?? "4004"), "0.0.0.0");
