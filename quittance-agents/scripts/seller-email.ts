import "dotenv/config";
import { Resend } from "resend";
import { createSellerServer } from "@quittance/server";

const resend = new Resend(process.env.RESEND_API_KEY!);
const FROM   = process.env.RESEND_FROM ?? "onboarding@resend.dev";

createSellerServer<{ to: string; subject?: string; body?: string; buyerAA: string }>({
  agentName:            process.env.SELLER_EMAIL_NAME    ?? "email.kite",
  price:                process.env.EMAIL_PRICE_UNITS    ?? "1000",
  deadlineSeconds:      parseInt(process.env.SELLER_DEADLINE_SEC       ?? "300"),
  cheapMode:            process.env.SELLER_CHEAP_MODE    === "true",
  cheapFailRate:        parseFloat(process.env.SELLER_CHEAP_FAIL_RATE  ?? "0.8"),
  cheapDeadlineSeconds: parseInt(process.env.SELLER_CHEAP_DEADLINE_SEC ?? "60"),
  minBondTier:          process.env.SELLER_CHEAP_MODE === "true" ? "bronze" : "silver",

  async deliver({ to, subject = "Your Quittance", body = "" }) {
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html: body });
    if (error) throw new Error(error.message);
    return `email:${to}:${(data as { id?: string })?.id}`;
  },
}).listen(parseInt(process.env.PORT ?? process.env.SELLER_EMAIL_PORT ?? "4002"), "0.0.0.0");
