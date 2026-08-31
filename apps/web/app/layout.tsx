import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "FinTwin — Holistic Financial Review",
  description: "Independent synthetic-data prototype for adviser preparation.",
  other: { google: "notranslate" },
  openGraph: {
    title: "FinTwin",
    description: "Clarity for your financial conversation.",
    images: [{ url: "/og.png", width: 1677, height: 943, alt: "FinTwin — Clarity for your financial conversation." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FinTwin",
    description: "Clarity for your financial conversation.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" translate="no">
      <body>{children}</body>
    </html>
  );
}
