import type { Metadata } from "next";
import Link from "next/link";
import { deployments } from "@/config/contracts";
import { LAYERZERO_TESTNET_ENDPOINT, bridgeChains } from "@/lib/bridge";
import { addressUrl } from "@/lib/deployment";

export const metadata: Metadata = {
  title: "Docs · NixSwap",
  description: "How NixSwap swaps, bridges, and launches tokens on Arbitrum, Base, and Ethereum Sepolia.",
};

const sections = [
  ["introduction", "Introduction"],
  ["swap", "How to swap"],
  ["bridge", "How to bridge"],
  ["launchpad", "Omnichain launchpad"],
  ["architecture", "Architecture"],
  ["contracts", "Smart contracts"],
  ["security", "Security"],
  ["builder", "About the Builder"],
];

const contractKeys = [
  "NixToken",
  "IntentRegistry",
  "NixPool",
  "NixLaunch",
  "NixLaunchpad",
  "LaunchFactory",
  "NixBridge",
] as const;

export default function DocsPage() {
  const chains = Object.values(deployments);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:py-14">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">NixSwap docs</h1>
        <p className="mt-3 text-sm leading-6 text-mist">
          NixSwap is a testnet exchange on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia. Swaps settle
          through a whitelisted solver. NIX moves by lock and release. Launched tokens move by burn and mint.
          Every balance, price, and fee in the app is read from those chains.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Documentation">
        {sections.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-frost hover:border-cyan-glow/40">
            {label}
          </a>
        ))}
      </nav>

      <section id="introduction" className="space-y-3">
        <h2 className="text-xl font-semibold">Introduction</h2>
        <p className="text-sm leading-6 text-mist">
          NIX is the quote asset. Each network has its own NIX contract. The bridge does not mint NIX. A launched
          token is an omnichain fungible token: the source chain mints the creator share and one pool share, and
          each other chain mints only its own pool share. The three supplies add up to the cap entered at launch.
        </p>
        <p className="text-sm leading-6 text-mist">
          The app prefers Arbitrum Sepolia. Connect a wallet, switch to a deployed network, and claim the faucet
          once per address per day. The faucet pays the on-chain drip, up to the token&apos;s faucet cap, from the
          owner wallet. It is hidden when the deployed token has no faucet.
        </p>
        <p className="text-sm leading-6 text-mist">
          Open the <Link href="/" className="text-cyan-glow">dashboard</Link>,{" "}
          <Link href="/swap" className="text-cyan-glow">swap</Link>,{" "}
          <Link href="/bridge" className="text-cyan-glow">bridge</Link>,{" "}
          <Link href="/portfolio" className="text-cyan-glow">portfolio</Link>, or{" "}
          <Link href="/markets" className="text-cyan-glow">markets</Link>. Pool and Launch stay available from the
          menu because both write to live contracts.
        </p>
      </section>

      <section id="swap" className="space-y-3">
        <h2 className="text-xl font-semibold">How to swap</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-mist">
          <li>Connect a wallet on a network that has IntentRegistry deployed.</li>
          <li>Choose the token you pay and the token you receive. One side of a pool route is NIX.</li>
          <li>Enter the amount. The form reads your balance and the pair reserves.</li>
          <li>Set slippage. The default is 0.50%. The minimum received is the constant-product quote minus that tolerance, and you can type a different minimum.</li>
          <li>Approve the registry once for the pay token. The approval is max uint256, so the trade size is not published in the approval.</li>
          <li>Submit. The amount, the minimum, and the target chain are encrypted with CoFHE. Token addresses stay public.</li>
        </ol>
        <p className="text-sm leading-6 text-mist">
          A confirmed swap stores an encrypted order. Balances move when the whitelisted solver fills it, before
          expiry. The solver calls the pool with your minimum as <span className="font-mono text-frost">minOut</span>.
          If the pool cannot pay that minimum, the order stays open. Price impact is the gap between the spot
          quote and the constant-product output. The network line shows the chain gas price. The wallet quotes
          the ETH cost of the proof and the transaction when you sign, because the proof does not exist until then.
        </p>
        <p className="text-sm leading-6 text-mist">
          Confidential amounts use 6 decimals. Public token balances use the token&apos;s own decimals, 18 for NIX
          and launched tokens. The registry scales a filled amount by 1e12 when it calls the pool.
        </p>
      </section>

      <section id="bridge" className="space-y-3">
        <h2 className="text-xl font-semibold">How to bridge</h2>
        <p className="text-sm leading-6 text-mist">
          Lock and release is for NIX and any other token registered on NixBridge. The source bridge locks your
          tokens. LayerZero tells the destination bridge to release the same amount from escrow. That path never
          mints. If destination escrow is short, the form tells you the shortfall and can switch you there with
          the deposit amount filled in. The cloud solver can also deposit NIX it already holds on that chain when
          escrow is below its target. It cannot pull escrow across chains.
        </p>
        <p className="text-sm leading-6 text-mist">
          Burn and mint is for a launched token whose endpoint id matches the source network. The source token
          burns the amount and the peer mints it. The token has to be relayed first, so the peer exists. A launch
          appears in the dropdown as soon as the launchpad returns it.
        </p>
        <p className="text-sm leading-6 text-mist">
          Both paths quote <span className="font-mono text-frost">quoteSend</span>. The wallet pays that native
          fee plus a tenth, and unused ETH is refunded. The quote does not include a delivery time, so the route
          card does not invent one. The route is source chain, the shared LayerZero V2 endpoint{" "}
          <span className="font-mono text-frost">{LAYERZERO_TESTNET_ENDPOINT}</span>, then the destination chain.
          A blank recipient means the connected wallet.
        </p>
      </section>

      <section id="launchpad" className="space-y-3">
        <h2 className="text-xl font-semibold">The omnichain launchpad</h2>
        <p className="text-sm leading-6 text-mist">
          Create token is one transaction on NixLaunchpad. The launchpad must be armed and wired to exactly three
          chains. Of the supply you enter, 94% is minted to your wallet on the source chain and 2% is seeded into
          the source NIX pair with 100 NIX. Each of the other two chains later mints only its 2% into its own
          pair. The number stored with the launch is the shared cap, not the amount minted on that chain. The
          launch card reads <span className="font-mono text-frost">totalSupply</span> for the minted amount.
        </p>
        <p className="text-sm leading-6 text-mist">
          Relay pays the LayerZero fee that authorizes the remote orders. After a remote chain holds 100 NIX, the
          solver finalizes that peer. One active launch per wallet. Retire closes it so you can create another.
          The token and its pair stay in the public list. Opening liquidity cannot be withdrawn as if it were a
          later deposit.
        </p>
      </section>

      <section id="architecture" className="space-y-3">
        <h2 className="text-xl font-semibold">Architecture</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-mist">
          <li>The browser talks to the three testnet RPCs through wagmi. Writes wait for the wallet signature, then for the receipt.</li>
          <li>Shielded inputs are encrypted in the browser with the CoFHE client bound to the connected wallet.</li>
          <li>IntentRegistry stores the order. A whitelisted solver decrypts it under the contract&apos;s rules and fills the pool.</li>
          <li>NixPair is the public constant-product market. Markets, the swap quote, and portfolio prices all read it.</li>
          <li>NixBridge locks registered tokens. LaunchToken burns and mints. They are different contracts and different balances.</li>
          <li>History walks recent logs on NIX, launched tokens, bridge tokens, pairs, the launchpad, and the registry. It keeps the newest 20 matches. An encrypted order is labeled &quot;Encrypted amount&quot;.</li>
        </ul>
        <p className="text-sm leading-6 text-mist">
          Endpoint ids: {bridgeChains.map((chain) => `${chain.name} ${chain.eid}`).join(", ")}.
        </p>
      </section>

      <section id="contracts" className="space-y-3">
        <h2 className="text-xl font-semibold">Smart contracts</h2>
        <p className="text-sm leading-6 text-mist">
          Addresses come from the deployment record the app uses. Each link opens that chain&apos;s block explorer.
        </p>
        <div className="overflow-x-auto rounded-[28px] border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-mist">
              <tr>
                <th className="px-3 py-2 font-medium">Contract</th>
                {chains.map((chain) => (
                  <th key={chain.chainId} className="px-3 py-2 font-medium">{chain.network}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contractKeys.map((key) => (
                <tr key={key} className="border-t border-white/5">
                  <td className="px-3 py-3 text-frost">{key}</td>
                  {chains.map((chain) => {
                    const address = chain[key];
                    const href = addressUrl(chain.chainId, address);
                    return (
                      <td key={chain.chainId} className="px-3 py-3 font-mono text-[11px] text-cyan-glow">
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer">
                            {address.slice(0, 6)}…{address.slice(-4)}
                          </a>
                        ) : (
                          address
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="security" className="space-y-3">
        <h2 className="text-xl font-semibold">Security</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-mist">
          <li>These contracts are on public testnets. Treat the assets as test assets.</li>
          <li>The repository does not publish a third-party audit or a bug bounty.</li>
          <li>Your key stays in the wallet. The app cannot sign for you.</li>
          <li>Swap size and limit are ciphertext. Token addresses, pool reserves, and the solver address are public.</li>
          <li>Only a solver the registry has whitelisted can fill your order. The registry owner can add or remove solvers.</li>
          <li>A fill reverts when the pool cannot pay your minimum. An order that expires is no longer fillable.</li>
          <li>Lock-and-release pays from escrow. Accounted escrow is not a balance the owner can withdraw. An empty destination cannot pay you until someone deposits on that chain.</li>
          <li>A bridge route is refused when the on-chain peer does not match the deployed bridge.</li>
          <li>Launch supply is capped, and a remote finalize checks that the minted amount is that chain&apos;s pool share.</li>
          <li>History and markets fail closed: a missing read is shown as unavailable. The interface does not substitute a sample number.</li>
        </ul>
      </section>

      <section id="builder" className="space-y-3">
        <h2 className="text-xl font-semibold">About the Builder</h2>
        <p className="text-sm leading-6 text-mist">
          <span className="text-frost">Built by:</span> JUBAYIR69
        </p>
        <p className="text-sm leading-6 text-mist">
          JUBAYIR69 is a passionate Web3 developer focusing on building high-performance, secure, and user-centric DeFi applications like NixSwap.
        </p>
        <ul className="space-y-2 text-sm leading-6 text-mist">
          <li>
            <span className="text-frost">Builder&apos;s Personal Website:</span>{" "}
            <a href="https://jubayir-69.vercel.app/" className="text-cyan-glow" target="_blank" rel="noreferrer">
              https://jubayir-69.vercel.app/
            </a>
          </li>
          <li>
            <span className="text-frost">Builder&apos;s Twitter:</span>{" "}
            <a href="https://x.com/alr80171" className="text-cyan-glow" target="_blank" rel="noreferrer">
              @alr80171
            </a>
          </li>
          <li>
            <span className="text-frost">Builder&apos;s Discord:</span>{" "}
            <a href="https://discordapp.com/users/1209377505442537484" className="text-cyan-glow" target="_blank" rel="noreferrer">
              discordapp.com/users/1209377505442537484
            </a>
          </li>
          <li>
            <span className="text-frost">NixSwap Official Twitter:</span>{" "}
            <a href="https://x.com/NixSwap" className="text-cyan-glow" target="_blank" rel="noreferrer">
              @NixSwap
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}
