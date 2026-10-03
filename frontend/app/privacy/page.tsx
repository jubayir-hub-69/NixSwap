import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · NixSwap",
  description: "How the NixSwap testnet interface handles wallet and network data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:py-14">
      <header>
        <p className="text-[11px] uppercase tracking-wide text-cyan-glow">Legal</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      </header>
      <section className="space-y-3 text-sm leading-6 text-mist">
        <p>
          NixSwap is a testnet interface. It does not create an account, and it does not take custody of your
          wallet or your keys. Transactions are signed in your wallet and broadcast to the network you select.
        </p>
        <p>
          A connected wallet address is public on that chain once you transact. The app reads balances, allowances,
          pool reserves, and related contract state from the Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia
          RPC endpoints configured in the client. Those providers receive the request your browser sends.
        </p>
        <p>
          Wallet connection is provided by RainbowKit and WalletConnect. If you use WalletConnect, that service
          processes the connection under its own policy. An injected wallet such as a browser extension connects
          locally.
        </p>
        <p>
          Confidential swap amounts are encrypted in the browser with CoFHE before they are submitted. Token
          addresses, pool reserves, and filled amounts that the contracts emit stay public. The interface does not
          sell personal data and does not run a separate user profile.
        </p>
        <p>
          Questions about this interface can be sent to{" "}
          <a href="https://x.com/NixSwap" className="text-cyan-glow" target="_blank" rel="noreferrer">
            @NixSwap
          </a>
          . The{" "}
          <Link href="/terms" className="text-cyan-glow">
            Terms of Service
          </Link>{" "}
          describe how the testnet software may be used.
        </p>
      </section>
    </main>
  );
}
