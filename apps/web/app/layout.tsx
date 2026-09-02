import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "FinTwin",
  description: "A financial companion that remembers what you tell it, works out what follows, and says what it does not know.",
  other: { google: "notranslate" },
  openGraph: { title: "FinTwin", description: "Your financial companion.", images: [{ url: "/og.png", width: 1677, height: 943, alt: "FinTwin" }] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f5f1" }, { media: "(prefers-color-scheme: dark)", color: "#111315" }] };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" translate="no" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" />
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("fintwin-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
