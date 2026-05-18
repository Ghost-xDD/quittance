import type { Metadata } from "next";
import { Fraunces, Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteChrome } from "@/components/site-chrome";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quittance — Proof-of-delivery for x402",
  description:
    "Exec-Pay-Deliver atomicity on Kite. Escrow, verifiable quittances, bonds, and reputation for agent commerce.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${fraunces.variable} ${geist.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="relative min-h-full bg-vellum text-print font-sans">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
