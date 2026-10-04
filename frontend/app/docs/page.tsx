import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { deployments } from "@/config/contracts";
import { LAYERZERO_TESTNET_ENDPOINT, bridgeChains } from "@/lib/bridge";
import { addressUrl } from "@/lib/deployment";

export const metadata: Metadata = {
  title: "Docs · NixSwap",
  description:
    "NixSwap documentation for confidential swaps, liquidity, on-chain token logos, contracts, and the developer API on Sepolia testnets.",
};

const sections = [
  ["introduction", "Introduction"],
  ["swap", "Swap"],
  ["pool", "Pool / Liquidity"],
  ["contracts", "Contracts"],
  ["api", "Developer API"],
] as const;

const contractKeys = [
  "NixToken",
  "IntentRegistry",
  "NixLaunchpad",
  "LaunchFactory",
  "NixBridge",
  "NixPool",
  "NixLaunch",
] as const;

const chainOrder = ["421614", "84532", "11155111"] as const;

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-mist">{children}</p>;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-ink/50 p-4 font-mono text-[12px] leading-5 text-frost">
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
  const chains = chainOrder.map((id) => deployments[id]);
  const arb = deployments["421614"];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <aside className="sticky top-24 hidden h-fit w-52 shrink-0 lg:block">
        <p className="text-[11px] uppercase tracking-wide text-cyan-glow">Documentation</p>
        <nav className="mt-4 grid gap-1" aria-label="Documentation">
          {sections.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-xl px-3 py-2 text-sm text-mist hover:bg-white/5 hover:text-frost"
            >
              {label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-10">
        <header className="space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-cyan-glow">NixSwap documentation</p>
          <h1 className="text-3xl font-semibold tracking-tight">Testnet documentation</h1>
          <P>
            NixSwap is an omnichain exchange on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia. NIX is the
            quote asset. Swap size and limit stay encrypted until a whitelisted solver fills the order. Balances,
            reserves, fees, and the faucet amount are read from the chain you are connected to.
          </P>
        </header>

        <nav className="grid grid-cols-2 gap-2 lg:hidden" aria-label="Documentation">
          {sections.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-2xl border border-white/10 px-3 py-3 text-sm text-frost hover:border-cyan-glow/40"
            >
              {label}
            </a>
          ))}
        </nav>

        <section id="introduction" className="scroll-mt-24 space-y-4">
          <h2 className="text-xl font-semibold">Introduction</h2>
          <P>
            The preferred wallet network is Arbitrum Sepolia (chain id 421614). <span className="font-mono text-frost">/</span>{" "}
            redirects to <span className="font-mono text-frost">/swap</span>. Open a surface from the bar, or from
            the list below.
          </P>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              ["/swap", "Swap", "Encrypt an order. The solver fills it on NixPair."],
              ["/bridge", "Bridge", "Lock and release NIX, or burn and mint a launched token."],
              ["/launch", "Launch", "Create a token and an optional on-chain logo. 94% to you, 2% liquidity on each chain."],
              ["/pool", "Pool", "Add or withdraw your own NixPair liquidity."],
              ["/markets", "Markets", "Public spot, reserves, and window volume."],
              ["/portfolio", "Portfolio", "Balances, send, receive, and recent history."],
            ].map(([href, title, copy]) => (
              <li key={href} className="glass-panel rounded-2xl p-4">
                <Link href={href} className="text-sm font-semibold text-frost hover:text-cyan-glow">
                  {title}
                </Link>
                <p className="mt-1 text-sm leading-6 text-mist">{copy}</p>
              </li>
            ))}
          </ul>
          <P>
            A launch on three wired chains mints 94% of the supply to the creator on the source chain. Each chain
            seeds 2% of the supply with 100 NIX into its own NixPair. That opening liquidity stays on the
            launchpad. The faucet pays the on-chain <span className="font-mono text-frost">FAUCET_DRIP</span> once
            per address per day. The current token source sets that drip at 500 NIX.
          </P>
          <P>
            The Launch form can take a token logo URL. An <span className="font-mono text-frost">https://</span> or{" "}
            <span className="font-mono text-frost">ipfs://</span> link of at most 200 bytes is stored permanently in{" "}
            <span className="font-mono text-frost">tokenLogo</span> and emitted as{" "}
            <span className="font-mono text-frost">TokenLogo</span>. The same link is appended to the LayerZero
            launch message, so <span className="font-mono text-frost">finalizeRemote</span> writes it on each peer
            chain. Portfolio, Launch, and Markets read that storage and show the image to every wallet. A blank
            link, a rejected link, or an image that fails to load keeps the symbol letter. An{" "}
            <span className="font-mono text-frost">ipfs://</span> link is loaded through{" "}
            <span className="font-mono text-frost">https://ipfs.io/ipfs/</span>.
          </P>
          <P>
            The app is Next.js, React, wagmi, and RainbowKit. Contracts are Solidity 0.8.28. Confidential orders
            use Fhenix CoFHE. Bridge and launch messages use the LayerZero V2 endpoint{" "}
            <span className="font-mono text-frost">{LAYERZERO_TESTNET_ENDPOINT}</span>. These contracts are on
            public testnets. Your key stays in the wallet. Only a whitelisted solver can fill an order.
          </P>
        </section>

        <section id="swap" className="scroll-mt-24 space-y-4">
          <h2 className="text-xl font-semibold">Swap</h2>
          <P>
            A swap is an intent, then a fill. <span className="font-mono text-frost">submitSwapIntent</span> stores
            the order and does not move tokens. Balances change when the solver calls{" "}
            <span className="font-mono text-frost">fillSwap</span>, which calls{" "}
            <span className="font-mono text-frost">NixPair.swap</span> and pays you.
          </P>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-mist">
            <li>Connect on a network where IntentRegistry is deployed.</li>
            <li>Choose the pay token and the receive token. One side of a pool route is NIX.</li>
            <li>Enter an amount. The form reads your balance and the pair reserves.</li>
            <li>Set slippage. Presets are 0.10%, 0.50%, and 1.00%. The default minimum is the constant-product quote minus that tolerance.</li>
            <li>Set an expiry inside the registry window. The default is 30 minutes, and the maximum is one hour.</li>
            <li>Approve the registry. The app approves max uint256 so the approval does not publish the trade size.</li>
            <li>Submit. The browser encrypts the amount, the minimum, and the target chain. Token addresses stay public.</li>
          </ol>
          <P>
            Confidential amounts use 6 decimals. The registry scales a filled amount by 1e12 before the pool call.
            The pool charges no fee:{" "}
            <span className="font-mono text-frost">reserveOut * amountIn / (reserveIn + amountIn)</span>. The order
            stays open when the quote is below the encrypted minimum, the target chain is different, the pair is
            not on the current launchpad, or the order has expired.
          </P>
          <P>
            One CoFHE batch encrypts the amount (<span className="font-mono text-frost">euint64</span>), the target
            chain id (<span className="font-mono text-frost">euint32</span>), and the minimum (
            <span className="font-mono text-frost">euint64</span>). The named solver later receives decrypt access.
            Until the fill, the size and the limit stay encrypted. The deployed solver is{" "}
            <span className="font-mono text-frost">{arb.deployer}</span>.
          </P>
        </section>

        <section id="pool" className="scroll-mt-24 space-y-4">
          <h2 className="text-xl font-semibold">Pool / Liquidity</h2>
          <P>
            Each launched token has one public <span className="font-mono text-frost">NixPair</span>. The launchpad
            opens it with 100 NIX and that chain&apos;s 2% of supply. The Pool page is for liquidity you add after
            that. If the current launchpad lists no token, launch one first.
          </P>
          <P>
            The form keeps the two amounts on the current reserve ratio. <span className="font-mono text-frost">addLiquidity(nixAmount, tokenAmount)</span>{" "}
            then pulls only the amounts that preserve that ratio. The button approves NIX, then the launch token,
            for that quoted pull, and sends those same two amounts. It does not send a deposit larger than the
            connected wallet&apos;s balance.
          </P>
          <P>
            <span className="font-mono text-frost">removeLiquidity(shares)</span> burns the caller&apos;s shares and
            returns both assets pro rata. Shares are raw integers, not 18-decimal token units. The withdraw action
            is available only when this wallet owns at least the requested shares and both outputs are non-zero.
            A wallet that has not deposited has no shares. The launchpad&apos;s opening position is not yours to
            withdraw.
          </P>
          <P>
            NixPool is a separate single-asset NIX vault. Markets, quotes, and this page do not call it.
          </P>
        </section>

        <section id="contracts" className="scroll-mt-24 space-y-4">
          <h2 className="text-xl font-semibold">Contracts</h2>
          <P>
            These are the contracts the app reads. Each link opens that chain&apos;s explorer.{" "}
            <span className="font-mono text-frost">NixPair</span> and <span className="font-mono text-frost">LaunchToken</span>{" "}
            are created per launch. Read them from <span className="font-mono text-frost">NixLaunchpad.allTokens</span>.
            Addresses can coincide across chains because of deployer nonce. Call the address on the row for the
            chain you are using.
          </P>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-mist">
                <tr>
                  <th className="px-3 py-3 font-medium">Contract</th>
                  {chains.map((chain) => (
                    <th key={chain.chainId} className="px-3 py-3 font-medium">
                      {chain.network}
                    </th>
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
          <P>
            LayerZero endpoint ids: {bridgeChains.map((chain) => `${chain.name} ${chain.eid}`).join(" · ")}. The
            shared endpoint is <span className="font-mono text-frost">{LAYERZERO_TESTNET_ENDPOINT}</span>.
          </P>
        </section>

        <section id="api" className="scroll-mt-24 space-y-4">
          <h2 className="text-xl font-semibold">Developer API</h2>
          <P>
            There is no separate router. A confidential swap enters through IntentRegistry. The fill settles on
            NixPair. Quotes, bridges, launches, and liquidity are direct calls. ABIs live in{" "}
            <span className="font-mono text-frost">frontend/config/contracts.ts</span>. Addresses live in{" "}
            <span className="font-mono text-frost">frontend/config/deployments.json</span>. Do not edit the
            generated ABI file by hand.
          </P>
          <h3 className="text-base font-semibold text-frost">Quote a pool</h3>
          <P>
            List pairs with <span className="font-mono text-frost">allTokens</span>, then call{" "}
            <span className="font-mono text-frost">quoteSwap</span>. <span className="font-mono text-frost">amountIn</span>{" "}
            is a public 18-decimal amount. The Arbitrum launchpad below has a listing only after{" "}
            <span className="font-mono text-frost">createToken</span>.
          </P>
          <Code>{`const listings = await client.readContract({
  address: "${arb.NixLaunchpad}",
  abi: nixLaunchpadAbi,
  functionName: "allTokens",
});

const amountOut = await client.readContract({
  address: listings[0].pair,
  abi: nixPairAbi,
  functionName: "quoteSwap",
  args: ["${arb.NixToken}", parseUnits("1", 18)],
});`}</Code>
          <h3 className="text-base font-semibold text-frost">Submit a swap</h3>
          <Code>{`function submitSwapIntent(
    address tokenIn,
    address tokenOut,
    IntentType intentType,          // SWAP = 0
    externalEuint64 encryptedAmount,
    externalEuint32 encryptedTargetChain,
    externalEuint64 encryptedLimit,
    bytes calldata inputProof,
    address solver,
    uint64 expiresAt
) external returns (uint256 intentId);`}</Code>
          <P>
            Confirm <span className="font-mono text-frost">isSolver(solver)</span> on that chain. Encrypt amount,
            target chain, and limit in one batch for the registry. Amount and limit use 6 decimals.{" "}
            <span className="font-mono text-frost">expiresAt</span> must fall inside the next hour. The submit
            receipt means the order is stored. <span className="font-mono text-frost">SwapFilled</span> means the
            public amounts moved.
          </P>
          <h3 className="text-base font-semibold text-frost">Liquidity, launch, and bridge</h3>
          <Code>{`function addLiquidity(uint256 nixAmount, uint256 tokenAmount) external returns (uint256 shares);
function removeLiquidity(uint256 shares) external returns (uint256 nixOut, uint256 tokenOut);`}</Code>
          <P>
            Approve both tokens to the pair, then pass the quoted pull. The pair can pull less than the arguments
            so the reserve ratio holds. <span className="font-mono text-frost">removeLiquidity</span> reverts with{" "}
            <span className="font-mono text-frost">InsufficientShares</span> when the caller does not own the
            shares. Launch with <span className="font-mono text-frost">createToken(name, symbol, supply)</span> or{" "}
            <span className="font-mono text-frost">createToken(name, symbol, supply, logoURI)</span>.{" "}
            <span className="font-mono text-frost">logoURI</span> is optional. A non-empty value must be an https://
            or ipfs:// link of at most 200 bytes. The launchpad stores it in{" "}
            <span className="font-mono text-frost">tokenLogo(token)</span>.{" "}
            <span className="font-mono text-frost">relay</span> carries that string in the LayerZero payload, and{" "}
            <span className="font-mono text-frost">finalizeRemote</span> copies it onto the peer token. Supply is the
            shared cap in wei. After the source launch, relay and finalize place the other pools and the logo.
            Bridge NIX with{" "}
            <span className="font-mono text-frost">NixBridge.send(dstEid, tokenId, amount, recipient)</span>.{" "}
            <span className="font-mono text-frost">dstEid</span> is the LayerZero endpoint id, and the NIX token id
            is <span className="font-mono text-frost">keccak256(&quot;NIX&quot;)</span>. A launched token uses{" "}
            <span className="font-mono text-frost">LaunchToken.send</span>, which burns and mints.
          </P>
        </section>
      </div>
    </main>
  );
}
