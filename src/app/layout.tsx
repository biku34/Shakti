import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shakti — Renewable Energy Intelligence",
  description: "P2P Energy Trading Marketplace + REC Fraud Detection",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
