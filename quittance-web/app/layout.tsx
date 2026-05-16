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

const NO_FLASH_THEME = `
(function(){try{
  var stored = localStorage.getItem('quittance:theme');
  var theme = stored === 'light' || stored === 'dark'
    ? stored
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
}catch(_){
  document.documentElement.dataset.theme = 'dark';
}})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${fraunces.variable} ${geist.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="relative min-h-full bg-vellum text-print font-sans">
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
