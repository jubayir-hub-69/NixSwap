import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { deployments } from "@/config/contracts";
import { LAYERZERO_TESTNET_ENDPOINT, bridgeChains } from "@/lib/bridge";
import { addressUrl } from "@/lib/deployment";

export const metadata: Metadata = {
  title: "Docs · NixSwap",
  description:
    "How NixSwap swaps, bridges, launches, and prices tokens on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia.",
};

const sections = [
  ["overview", "Overview"],
  ["swap", "Confidential swap"],
  ["bridge", "Bridge"],
  ["launchpad", "Launchpad"],
  ["pool", "Pool"],
  ["portfolio", "Portfolio"],
  ["markets", "Markets"],
  ["fhenix", "Fhenix and CoFHE"],
  ["integrate", "Integrate"],
  ["architecture", "Architecture"],
  ["contracts", "Contracts"],
  ["security", "Security"],
  ["builder", "About the Builder"],
] as const;

const contractKeys = [
  "NixToken",
  "IntentRegistry",
  "NixPool",
  "NixLaunch",
  "NixLaunchpad",
  "LaunchFactory",
  "NixBridge",
] as const;

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-mist">{children}</p>;
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-base font-semibold text-frost">{children}</h3>;
}

function Bullet({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-mist">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-ink/50 p-4 font-mono text-[12px] leading-5 text-frost">
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
  const chains = Object.values(deployments);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:py-14">
      <header>
        <p className="text-[11px] uppercase tracking-wide text-cyan-glow">NixSwap documentation</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">An omnichain DeFi hub</h1>
        <P>
          NixSwap is a testnet exchange for Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia. One session
          covers a confidential swap, a LayerZero bridge, an omnichain launch, public liquidity, a portfolio, and
          a live market board. NIX is the quote asset. Every balance, price, fee, and faucet amount in the app is
          read from those chains.
        </P>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Documentation">
        {sections.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-frost hover:border-cyan-glow/40"
          >
            {label}
          </a>
        ))}
      </nav>

      <section id="overview" className="glass-panel scroll-mt-24 space-y-3 rounded-[28px] p-5">
        <h2 className="text-xl font-semibold">Project overview</h2>
        <P>
          The app prefers Arbitrum Sepolia. Connect a wallet, switch to a deployed network, and claim the faucet
          once per address per day. The faucet pays the on-chain <span className="font-mono text-frost">FAUCET_DRIP</span>{" "}
          from the NIX owner. The current token source sets that drip at 500 NIX, with a budget of 100,000,000 NIX.
          The button shows the value the connected token returns, and it is hidden when that read fails.
        </P>
        <P>
          Open{" "}
          <Link href="/swap" className="text-cyan-glow">swap</Link>,{" "}
          <Link href="/bridge" className="text-cyan-glow">bridge</Link>,{" "}
          <Link href="/portfolio" className="text-cyan-glow">portfolio</Link>,{" "}
          <Link href="/markets" className="text-cyan-glow">markets</Link>,{" "}
          <Link href="/launch" className="text-cyan-glow">launch</Link>, or{" "}
          <Link href="/pool" className="text-cyan-glow">pool</Link>.
          This page lives in the navbar More menu. <span className="font-mono text-frost">/</span> redirects to{" "}
          <span className="font-mono text-frost">/swap</span> and keeps the query string.{" "}
          <span className="font-mono text-frost">/history</span> opens the portfolio History tab.{" "}
          <span className="font-mono text-frost">/send</span> opens portfolio.{" "}
          <span className="font-mono text-frost">/trade</span> opens the bridge.
        </P>
        <Bullet
          items={[
            "Confidential swap. The route is public. Amount, target chain, and minimum stay encrypted until the cloud solver fills the order on NixPair.",
            "LayerZero bridge. NIX locks and releases through NixBridge. A launched token burns on the source and mints on the destination.",
            "Omnichain launchpad. One signature creates the token. 94% goes to the creator on the source chain. 6% is auto-liquidity: 2% paired with 100 NIX on each of the three chains.",
            "Pool. Add or withdraw liquidity on a launched NixPair. Opening liquidity stays on the launchpad.",
            "Portfolio. Live balances, a NIX-denominated total, send, receive, and history across the three networks.",
            "Markets. Public spot, reserves, 24-hour mark, and window volume for every token the current launchpad lists.",
          ]}
        />
      </section>

      <section id="swap" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Confidential swap</h2>
        <P>
          A swap is an intent, then a fill. <span className="font-mono text-frost">submitSwapIntent</span> stores
          the order and does not move tokens. Balances change when the whitelisted solver calls{" "}
          <span className="font-mono text-frost">fillSwap</span>, which calls{" "}
          <span className="font-mono text-frost">NixPair.swap</span> and pays the user.
        </P>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-mist">
          <li>Connect a wallet on a network that has IntentRegistry deployed.</li>
          <li>Choose the token you pay and the token you receive. One side of a pool route is NIX.</li>
          <li>Enter the amount. The form reads your balance and the pair reserves.</li>
          <li>Set slippage. The default is 0.50%. Presets are 0.10%, 0.50%, and 1.00%. The minimum received is the constant-product quote minus that tolerance, floored to 6 confidential decimals. You can type a different minimum.</li>
          <li>Set an expiry. The default is 30 minutes. The registry accepts at most one hour (<span className="font-mono text-frost">MAX_WINDOW</span>).</li>
          <li>Approve the registry for the pay token. The app approves max uint256, so the trade size is not published in the approval.</li>
          <li>Submit. The browser encrypts the amount, the minimum, and the target chain with CoFHE. Token addresses stay public.</li>
        </ol>
        <P>
          The solver leaves the order open when the pool cannot pay the minimum, when the encrypted target chain
          is a different network, when the pair is not on the current launchpad, or when the order has expired.
          Price impact is the gap between the spot quote and the constant-product output. The network line shows
          the chain gas price. The wallet quotes the ETH cost of the proof and the transaction when you sign,
          because the proof does not exist until then.
        </P>
        <P>
          Confidential amounts use 6 decimals. Public balances use the token&apos;s own decimals, 18 for NIX and
          launched tokens. The registry multiplies a filled amount by 1e12 before it calls the pool. The pool
          formula has no fee:{" "}
          <span className="font-mono text-frost">reserveOut * amountIn / (reserveIn + amountIn)</span>.
        </P>
        <P>
          The solver field defaults to the deployment&apos;s deployer,{" "}
          <span className="font-mono text-frost">0x9AFe5CeF11fC10756faef213f7A30D9873B5d372</span>. That address
          is whitelisted on the current registries. The registry owner can call{" "}
          <span className="font-mono text-frost">setSolver</span> from the form when the selected solver is not
          yet allowed.
        </P>
      </section>

      <section id="bridge" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">LayerZero bridge</h2>
        <H3>Lock and release</H3>
        <P>
          Lock and release is for NIX and any other token registered on NixBridge. The source bridge locks the
          exact amount. LayerZero tells the destination bridge to release the same amount from escrow. That path
          never mints. If destination escrow is short, the form shows the shortfall and can switch you there with
          the deposit amount filled in. <span className="font-mono text-frost">deposit</span> adds tokens to the
          escrow book on the chain you are connected to. The cloud solver can also deposit NIX it already holds
          when escrow is below its target. It cannot pull escrow across chains.
        </P>
        <P>
          NIX is registered under <span className="font-mono text-frost">keccak256(&quot;NIX&quot;)</span>. Deployed
          NIX routes start at 50,000 NIX of capacity and refill over one hour. An unset limit fails closed. The
          form reads <span className="font-mono text-frost">rateLimit</span>, <span className="font-mono text-frost">accounted</span>,
          and <span className="font-mono text-frost">peers</span>. A route whose on-chain peer does not match the
          deployed bridge is refused. Accounted escrow is not a balance the owner can withdraw.
        </P>
        <H3>Burn and mint</H3>
        <P>
          Burn and mint is for a launched token whose endpoint id matches the source network.{" "}
          <span className="font-mono text-frost">LaunchToken.send</span> burns the amount. The peer mints it.
          The token has to be relayed first, so the peer exists. A launch appears in the dropdown as soon as the
          launchpad returns it.
        </P>
        <H3>Fees and the route card</H3>
        <P>
          Both paths quote <span className="font-mono text-frost">quoteSend</span>. The wallet pays that native
          fee plus a tenth, and unused ETH is refunded. The quote does not include a delivery time, so the route
          card does not invent one. The route is the source chain, the shared LayerZero V2 endpoint{" "}
          <span className="font-mono text-frost">{LAYERZERO_TESTNET_ENDPOINT}</span>, then the destination chain.
          A blank recipient means the connected wallet. Portfolio send is a normal token transfer and requires
          an explicit recipient.
        </P>
        <P>
          Endpoint ids: {bridgeChains.map((chain) => `${chain.name} ${chain.eid}`).join(", ")}.
        </P>
      </section>

      <section id="launchpad" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Omnichain launchpad</h2>
        <P>
          Create token is one transaction on NixLaunchpad. The launchpad must be armed and wired to exactly three
          chains. Of the supply you enter, 94% is minted to your wallet on the source chain and 2% is seeded into
          the source NIX pair with 100 NIX. Each of the other two chains later mints only its 2% into its own
          pair. Those three pool shares are the 6% auto-liquidity. The creator does not approve or spend NIX.
          The opening LP stays on the launchpad.
        </P>
        <P>
          A supply of 10000000 is 10 million tokens. The creator receives 9,400,000 on the source chain. Each
          pair receives 200,000 tokens and 100 NIX. The cap is 1 trillion tokens. The name is 1 to 32 bytes. The
          symbol is 1 to 11 bytes. The number stored with the launch is the shared cap, not the amount minted on
          that chain. The launch card reads <span className="font-mono text-frost">totalSupply</span> for the
          minted amount.
        </P>
        <P>
          <span className="font-mono text-frost">chainSlots()</span> on the current pads returns 3 chains, 200
          basis points per chain, and 9400 basis points for the creator. viem returns that tuple as indexes 0, 1,
          and 2. <span className="font-mono text-frost">seedCapacity</span> reports how many opening pools the
          launchpad&apos;s NIX balance still covers. Each current pad holds 10,000 NIX, which is 100 seeds.
          Creation reverts when the seed is short or when the pad is not wired to three chains.
        </P>
        <P>
          Relay pays the LayerZero fee that authorizes the remote orders. Anyone can pay it, and the solver pays
          it when the service is running. After a remote chain holds 100 NIX,{" "}
          <span className="font-mono text-frost">finalizeRemote</span> deploys the peer token and seeds that pool.
          One active launch per wallet. Retire closes it so you can create another. The token and its pair stay
          in the public list. Trade links go to <span className="font-mono text-frost">/swap?token=</span> and{" "}
          <span className="font-mono text-frost">/pool?token=</span>.
        </P>
      </section>

      <section id="pool" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Pool and liquidity</h2>
        <P>
          A launch opens the pool. This page adds a further deposit, or withdraws shares from a deposit you
          added. The market contract is NixPair. If the current launchpad has no tokens, the page says to launch
          one first. That empty state is the live factory, which starts with zero tokens.
        </P>
        <P>
          <span className="font-mono text-frost">addLiquidity</span> pulls both assets at the current reserve
          ratio. Approve the exact public amounts first. The page refuses a deposit larger than the connected
          wallet&apos;s NIX or token balance. <span className="font-mono text-frost">removeLiquidity</span> burns
          your shares and returns both assets pro rata. Those shares do not include the launchpad&apos;s opening
          position.
        </P>
        <P>
          NixPool is a different contract: a single-asset NIX vault with encrypted share balances and a public
          reserve. Markets, quotes, and this page do not read it.
        </P>
      </section>

      <section id="portfolio" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Portfolio</h2>
        <P>
          Portfolio reads the connected wallet on each NixSwap network. NIX, bridge-registered tokens, and
          launched tokens are included when those contracts are deployed. A disconnected wallet shows Connect to
          read. A failed read shows Unavailable.
        </P>
        <P>
          The priced total is in NIX. Marks come from live NixPair prices. NIX counts at face value. A token
          with no spot price is listed and left out of the total. There is no USD total. The 24-hour change uses
          the same pool marks, and it stays unavailable until a held token has one.
        </P>
        <Bullet
          items={[
            "Send calls ERC-20 transfer on the selected token. The recipient is required. This is not a bridge.",
            "Receive shows the connected address, a copy button, and a QR code.",
            "Add to wallet reads symbol and decimals, then calls wallet_watchAsset. There is no shared token image.",
            "History is a tab on this page and the target of /history. It reads recent logs on all three networks and keeps the newest 20 matches. An encrypted order is labeled Encrypted amount.",
          ]}
        />
      </section>

      <section id="markets" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Real-time markets</h2>
        <P>
          Markets lists <span className="font-mono text-frost">NixLaunchpad.allTokens</span> and reads each
          NixPair. Spot price is <span className="font-mono text-frost">priceX18</span>{" "}
          (<span className="font-mono text-frost">reserveNix * 1e18 / reserveToken</span>). The 24-hour column
          is the change since the on-chain daily mark. Until that mark rolls, it shows the change since launch
          or the last reserve update. Volume is NIX added to the pool during the current one-day window.
        </P>
        <P>
          Pair reserves, spot, and window volume are public. A wallet&apos;s swap size and limit stay encrypted.
          Zero reserves mean no liquidity was deposited. A row links to swap and pool for that token. The board
          follows the factory in the deployment record. Tokens created on an older factory stay on that factory
          and do not appear here.
        </P>
      </section>

      <section id="fhenix" className="glass-panel scroll-mt-24 space-y-3 rounded-[28px] p-5">
        <h2 className="text-xl font-semibold">Fhenix and CoFHE</h2>
        <P>
          NixSwap uses Fhenix CoFHE for the confidential part of a swap. Contracts import{" "}
          <span className="font-mono text-frost">FHE</span>, <span className="font-mono text-frost">euint64</span>,
          and <span className="font-mono text-frost">euint32</span> from{" "}
          <span className="font-mono text-frost">@fhenixprotocol/cofhe-contracts</span>. The browser and the solver
          use <span className="font-mono text-frost">@cofhe/sdk</span>. The concept reference is{" "}
          <a href="https://cofhe-docs.fhenix.zone/" className="text-cyan-glow" target="_blank" rel="noreferrer">
            cofhe-docs.fhenix.zone
          </a>
          . CoFHE keeps a ciphertext handle on chain. A contract chooses who may decrypt it. A decrypted result
          is accepted only when <span className="font-mono text-frost">FHE.verifyDecryptResultSafe</span> accepts
          the proof.
        </P>
        <H3>What the app encrypts</H3>
        <P>
          The web client is <span className="font-mono text-frost">createCofheClient</span> from{" "}
          <span className="font-mono text-frost">@cofhe/sdk/web</span>, connected to the wagmi public client and
          wallet client. Supported CoFHE chains are Ethereum Sepolia, Arbitrum Sepolia, and Base Sepolia. One
          batch encrypts, in order, the amount as <span className="font-mono text-frost">uint64</span>, the
          target chain id as <span className="font-mono text-frost">uint32</span>, and the minimum as{" "}
          <span className="font-mono text-frost">uint64</span>. The consuming contract is that chain&apos;s
          IntentRegistry. The three handles and one <span className="font-mono text-frost">inputProof</span> are
          the arguments to <span className="font-mono text-frost">submitSwapIntent</span>.
        </P>
        <P>
          On submission the registry calls <span className="font-mono text-frost">FHE.allowThis</span>. The user,
          the public, and any other address cannot decrypt the order. The named solver later calls{" "}
          <span className="font-mono text-frost">grantSolverAccess</span>, which calls{" "}
          <span className="font-mono text-frost">FHE.allow</span> for the three handles. That call reverts after
          expiry, so a late solver never receives access. CoFHE ACL entries do not expire by themselves. The
          registry is what refuses a late grant.
        </P>
        <P>
          <span className="font-mono text-frost">fillSwap</span> checks the three proofs, checks that the target
          chain equals <span className="font-mono text-frost">block.chainid</span>, scales the 6-decimal values
          by 1e12, pulls public ERC-20 tokens, and swaps them on NixPair. Settlement is a public transfer sized
          from the decrypted order. The tokens are not moved as ciphertext. Token addresses, reserves, the
          solver address, and the amounts in <span className="font-mono text-frost">SwapFilled</span> are public.
          Until the fill, the size and the limit stay encrypted.
        </P>
        <H3>Other FHE contracts</H3>
        <P>
          NixToken can also hold a confidential balance. Shield moves public tokens into a custody address.
          Unshield returns them after a verified claim. Confidential units use 6 decimals. An insufficient
          confidential spend moves encrypted zero instead of reverting, so the failure does not reveal the
          balance. The swap form does not shield. It spends the public balance at fill time.
        </P>
        <P>
          NixPool stores each liquidity provider&apos;s shares as an <span className="font-mono text-frost">euint64</span>{" "}
          and keeps the total reserve in plaintext. NixLaunch is a sealed-bid sale whose bids stay ciphertext
          until the window ends. Both contracts are deployed and listed below. The live Pool and Launch screens
          call NixPair and NixLaunchpad.
        </P>
      </section>

      <section id="integrate" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Smart-contract integration</h2>
        <P>
          A confidential swap enters through IntentRegistry. The fill settles on NixPair. NixSwap does not
          publish a separate router. Quotes, bridges, launches, and liquidity are direct calls on the contracts
          in the table further down. ABIs are generated into{" "}
          <span className="font-mono text-frost">frontend/config/contracts.ts</span>. Addresses come from{" "}
          <span className="font-mono text-frost">frontend/config/deployments.json</span>. Do not edit the
          generated file by hand.
        </P>
        <P>
          Some addresses coincide across chains because of deployer nonce. They are not shared contracts. Call
          the address on the row for the chain you are using. Ethereum Sepolia&apos;s LaunchFactory equals Base
          Sepolia&apos;s NixLaunchpad. Ethereum&apos;s NixBridge equals an older Arbitrum launchpad.
        </P>
        <H3>Query a pool</H3>
        <P>
          List pairs with <span className="font-mono text-frost">allTokens</span>, then call{" "}
          <span className="font-mono text-frost">quoteSwap(tokenIn, amountIn)</span>.{" "}
          <span className="font-mono text-frost">amountIn</span> is a public 18-decimal amount. Also read{" "}
          <span className="font-mono text-frost">reserveNix</span>, <span className="font-mono text-frost">reserveToken</span>,{" "}
          <span className="font-mono text-frost">priceX18</span>, and <span className="font-mono text-frost">volumeWindowNix</span>.
        </P>
        <Code>{`const listings = await client.readContract({
  address: "0x86798f4777A48a3aA6cd2B1bee0E5BF7C85806eb",
  abi: nixLaunchpadAbi,
  functionName: "allTokens",
});

const amountOut = await client.readContract({
  address: listings[0].pair,
  abi: nixPairAbi,
  functionName: "quoteSwap",
  args: ["0xfE128bCc8F4D45AB9E24bF446EEa8302d1FD4CB7", parseUnits("1", 18)],
});`}</Code>
        <P>
          The Arbitrum launchpad above currently has no tokens, so{" "}
          <span className="font-mono text-frost">listings[0]</span> exists only after the first{" "}
          <span className="font-mono text-frost">createToken</span>. Read <span className="font-mono text-frost">tokenCount</span> first.
        </P>
        <H3>Submit an intent</H3>
        <Bullet
          items={[
            "Confirm isSolver(solver) on that chain's registry. The deployed solver is 0x9AFe5CeF11fC10756faef213f7A30D9873B5d372.",
            "Approve IntentRegistry for the pay token.",
            "Encrypt amount, target chain, and limit in one CoFHE batch. Amount and limit use 6 decimals. The target is the EVM chain id. The consuming contract is the registry.",
            "Call submitSwapIntent(tokenIn, tokenOut, 0, encryptedAmount, encryptedTargetChain, encryptedLimit, inputProof, solver, expiresAt). Intent type 0 is SWAP. expiresAt must be within the next hour.",
          ]}
        />
        <P>
          The submit receipt means the order is stored. <span className="font-mono text-frost">SwapFilled</span>{" "}
          means the public amounts moved. <span className="font-mono text-frost">getIntent</span> returns
          ciphertext handles, not the cleartext size.
        </P>
        <H3>What the cloud solver does</H3>
        <P>
          The loop in <span className="font-mono text-frost">scripts/solver-core.ts</span> polls every configured
          chain. For an open intent named to this solver it skips a route that is not on the current launchpad,
          calls <span className="font-mono text-frost">grantSolverAccess</span> once, decrypts the three fields
          with <span className="font-mono text-frost">@cofhe/sdk/node</span>, and leaves the order open if the
          target chain differs or the quote is below the minimum. Otherwise it calls{" "}
          <span className="font-mono text-frost">fillSwap</span> with the cleartext tuple and the three
          decryption signatures. The same process relays launches, finalizes remote pools, retries a verified
          bridge message, and can deposit NIX it already holds into a short escrow.
        </P>
        <P>
          On Render, the service root is this repository. Build is{" "}
          <span className="font-mono text-frost">npm install && npm run build</span>. Start is{" "}
          <span className="font-mono text-frost">npm start</span>. <span className="font-mono text-frost">GET /</span>{" "}
          returns <span className="font-mono text-frost">Solver Active</span>. Leave{" "}
          <span className="font-mono text-frost">PORT</span> unset so Render can set it. A free instance sleeps
          after 15 minutes without a request, so ping <span className="font-mono text-frost">/</span> about every
          10 minutes to keep fills running. Rebuild after <span className="font-mono text-frost">deployments.json</span>{" "}
          changes. The process reads launchpad addresses from that file at startup.
        </P>
        <H3>Bridge and launch calls</H3>
        <P>
          Lock and release: approve the bridge, then{" "}
          <span className="font-mono text-frost">send(dstEid, tokenId, amount, recipient)</span> with value.
          <span className="font-mono text-frost"> dstEid</span> is the LayerZero endpoint id, not the EVM chain
          id. The NIX token id is <span className="font-mono text-frost">keccak256(&quot;NIX&quot;)</span>. Quote
          first. Read the destination <span className="font-mono text-frost">accounted</span> balance and{" "}
          <span className="font-mono text-frost">peers</span> before promising a release.{" "}
          <span className="font-mono text-frost">deposit(tokenId, amount)</span> funds escrow on the connected
          chain.
        </P>
        <P>
          Burn and mint: call <span className="font-mono text-frost">send(dstEid, recipient, amount)</span> on
          the LaunchToken. It burns from the caller. The peer must already be set.
        </P>
        <P>
          Launch: <span className="font-mono text-frost">createToken(name, symbol, supply)</span> with{" "}
          <span className="font-mono text-frost">supply</span> in 18-decimal units. Then{" "}
          <span className="font-mono text-frost">relay(id)</span> with the value from{" "}
          <span className="font-mono text-frost">quoteRelay</span>. Remote pools appear after{" "}
          <span className="font-mono text-frost">finalizeRemote</span> on each peer. Further liquidity is{" "}
          <span className="font-mono text-frost">addLiquidity</span> on the pair after approving both tokens.
          The pair may pull less than requested so the reserve ratio holds.
        </P>
      </section>

      <section id="architecture" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Architecture and stack</h2>
        <P>
          The browser talks to the three testnet RPCs through wagmi. Writes wait for the wallet signature, then
          for the receipt. Shielded inputs are encrypted in the browser with the CoFHE client bound to the
          connected wallet. IntentRegistry stores the order. The solver decrypts it under the contract&apos;s
          rules and fills the pool. LayerZero carries launch authorization and both bridge payloads.
        </P>
        <Bullet
          items={[
            "Interface: Next.js 16.3.6 on the App Router and webpack, React 19, TypeScript, and Tailwind CSS 4. Webpack is required because Turbopack deadlocks while tracing @cofhe/sdk.",
            "UI: dialogs, menus, and tabs are Radix primitives in frontend/components/ui, styled with Tailwind, clsx, tailwind-merge, and lucide-react. That is the local-component pattern shadcn/ui uses. This repo does not install the shadcn CLI.",
            "Wallet: wagmi, viem, and RainbowKit. The initial chain is Arbitrum Sepolia.",
            "Contracts: Solidity 0.8.28, Hardhat, Cancun, OpenZeppelin 5.4, and Fhenix CoFHE.",
            "Solver: Node.js, TypeScript, and ethers, one process for every configured chain, deployed as a Render web service.",
            "Messaging: LayerZero V2 endpoint " + LAYERZERO_TESTNET_ENDPOINT + ".",
          ]}
        />
        <Code>{`Wallet -> Next.js app -> CoFHE encrypt
App -> IntentRegistry.submitSwapIntent
Solver -> grantSolverAccess -> decrypt -> NixPair.quoteSwap -> fillSwap
App -> NixLaunchpad.createToken -> relay
Solver -> finalizeRemote on each peer
App -> NixBridge.send  or  LaunchToken.send
LayerZero V2 -> destination release or mint`}</Code>
      </section>

      <section id="contracts" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Smart contracts</h2>
        <P>
          These are the contracts the app reads. Each link opens that chain&apos;s block explorer. NixPair and
          LaunchToken are created per launch. Read them from{" "}
          <span className="font-mono text-frost">allTokens</span>. NixPool and NixLaunch are deployed FHE
          contracts. The trading and launch screens use NixPair and NixLaunchpad.
        </P>
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
        <P>
          Each current launchpad reports three chain slots, holds 10,000 NIX for 100 opening pools, and has both
          remote peers set. NIX, IntentRegistry, NixPool, NixLaunch, and NixBridge were not replaced when those
          launchpads were deployed.
        </P>
      </section>

      <section id="security" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">Security</h2>
        <Bullet
          items={[
            "These contracts are on public testnets. Treat the assets as test assets.",
            "The repository does not publish a third-party audit or a bug bounty.",
            "Your key stays in the wallet. The app cannot sign for you.",
            "Swap size and limit are ciphertext until the solver fills the order. Token addresses, pool reserves, and the solver address are public.",
            "Only a solver the registry has whitelisted can be named, and only that solver can fill the order. The registry owner can add or remove solvers.",
            "A fill reverts when the pool cannot pay the minimum. An expired order is no longer fillable, and grantSolverAccess reverts after expiry.",
            "Lock-and-release pays from escrow. An empty destination cannot pay you until someone deposits on that chain.",
            "A bridge route is refused when the on-chain peer does not match the deployed bridge.",
            "Launch supply is capped. A remote finalize checks that the minted amount is that chain's pool share.",
            "History and markets fail closed. A missing read is shown as unavailable. The interface does not substitute a sample number.",
          ]}
        />
      </section>

      <section id="builder" className="scroll-mt-24 space-y-3">
        <h2 className="text-xl font-semibold">About the Builder</h2>
        <P>
          <span className="text-frost">Built by:</span> JUBAYIR69
        </P>
        <P>
          JUBAYIR69 is a passionate Web3 developer focusing on building high-performance, secure, and user-centric DeFi applications like NixSwap.
        </P>
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
