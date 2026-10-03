import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service · NixSwap",
  description: "Terms for using the NixSwap testnet interface.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:py-14">
      <header>
        <p className="text-[11px] uppercase tracking-wide text-cyan-glow">Legal</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Terms of Service</h1>
      </header>
      <section className="space-y-3 text-sm leading-6 text-mist">
        <p>
          NixSwap is testnet software for Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia. Tokens on these
          networks are test assets. They have no mainnet value, and the interface is not a bank, broker, or
          custodian.
        </p>
        <p>
          You are responsible for every transaction you sign. A swap, bridge, launch, liquidity deposit, or
          withdrawal can fail, and a signed transaction cannot be reversed by this interface. Review the token,
          the amount, and the network in your wallet before you confirm.
        </p>
        <p>
          Contracts, addresses, and this interface can change. Reads can fail when an RPC is unavailable. The
          software is provided as is, without a warranty of uptime, profit, or fitness for a particular purpose.
          The repository does not publish a third-party audit.
        </p>
        <p>
          Do not use the interface if you do not agree to these terms. See the{" "}
          <Link href="/privacy" className="text-cyan-glow">
            Privacy Policy
          </Link>{" "}
          for how wallet and network data is handled, and the{" "}
          <Link href="/docs" className="text-cyan-glow">
            docs
          </Link>{" "}
          for how the contracts behave.
        </p>
      </section>
    </main>
  );
}
