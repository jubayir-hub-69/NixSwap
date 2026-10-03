import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NixSwap",
  description:
    "Shielded swaps, a LayerZero bridge, and portfolio history on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookie = (await headers()).get("cookie");

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col font-sans">
        <ThemeProvider>
          <div className="atmosphere" aria-hidden="true" />
          <div className="relative z-10 flex min-h-dvh flex-1 flex-col">
            <Providers cookie={cookie}>
              <div className="flex min-h-dvh flex-col">
                <Navbar />
                <div className="flex flex-1 flex-col">{children}</div>
                <SiteFooter />
              </div>
            </Providers>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
