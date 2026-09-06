import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SignalForge — Strategy Backtesting",
  description: "Build, run, and compare custom trading algorithms on historical market data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
