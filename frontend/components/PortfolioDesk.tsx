"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { AddToWalletButton } from "@/components/AddToWalletButton";
import { HistoryDesk } from "@/components/HistoryDesk";
import { PricedSummary } from "@/components/PricedSummary";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrAddress } from "@/components/QrAddress";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useChainHoldings, type Holding } from "@/hooks/useChainHoldings";
import { decimalInput, formatBalance, formatUnits, parseUnits, plainUnits } from "@/lib/amount";
import { bridgeChain, parseWalletAddress } from "@/lib/bridge";
import { errorText, preferredChainId } from "@/lib/deployment";
import { shortAddress } from "@/lib/markets";
import { isWalletProvider, switchWalletChain } from "@/lib/walletChain";

const fieldClass = "mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost";
const buttonClass = "btn-primary min-h-11 rounded-2xl px-4 py-2.5 text-sm font-semibold";

type Selection = { chainId: number; token: `0x${string}`; mode: "send" | "receive" };

function findHolding(holdings: Holding[], token: `0x${string}`) {
  return holdings.find((item) => item.address.toLowerCase() === token.toLowerCase());
}

function SendPanel({
  chainId,
  chainName,
  holding,
  onClose,
}: {
  chainId: number;
  chainName: string;
  holding: Holding;
  onClose: () => void;
}) {
  const tx = useChainTx();
  const [amount, setAmount] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const decimals = holding.decimals;
  const symbol = holding.symbol ?? "Token";
  const parsed = decimals === undefined ? null : parseUnits(amount, decimals);
  const recipient = parseWalletAddress(recipientInput);
  const recipientInvalid = recipientInput.trim() !== "" && recipient === null;

  let blocker: string | null = null;
  if (holding.loading) blocker = "Reading this token…";
  else if (holding.error || decimals === undefined || holding.balance === undefined) blocker = "This token balance is unavailable on this network.";
  else if (recipientInvalid || recipientInput.trim() === "") blocker = "Enter the wallet address that should receive the tokens.";
  else if (!recipient) blocker = "Enter a valid recipient address. The zero address cannot receive tokens.";
  else if (amount.trim() === "") blocker = "Enter an amount.";
  else if (parsed === null) blocker = `Use at most ${decimals} decimal places.`;
  else if (parsed === 0n) blocker = "Enter an amount greater than zero.";
  else if (parsed > holding.balance) {
    blocker = `This wallet holds ${formatUnits(holding.balance, decimals)} ${symbol}, which is less than ${formatUnits(parsed, decimals)} ${symbol}.`;
  }

  async function send() {
    if (!recipient || parsed === null || blocker) return;
    await tx.submit(() =>
      tx.writeContractAsync({
        address: holding.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient, parsed],
        chainId,
      }),
    );
  }

  return (
    <form
      className="glass-panel rounded-[28px] p-5"
      data-testid="portfolio-send"
      onSubmit={(event) => {
        event.preventDefault();
        if (tx.pending || blocker) return;
        void send();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-frost">Send {symbol}</h2>
          <p className="mt-1 text-xs leading-5 text-mist">
            This transfer stays on {chainName}. The token is the one you selected in the portfolio.
          </p>
        </div>
        <button type="button" className="text-xs text-mist" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="field-well mt-4 block rounded-3xl px-4 py-3">
        <span className="mb-1 flex items-baseline justify-between text-xs text-mist">
          <span>Amount</span>
          <span>
            {formatBalance(true, holding.loading, holding.error || decimals === undefined, holding.balance, decimals ?? 18)} {decimals !== undefined ? symbol : ""}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <input
            data-testid="portfolio-send-amount"
            value={amount}
            inputMode="decimal"
            placeholder="0"
            aria-label={`Send ${symbol} amount`}
            onChange={(event) => {
              const next = decimalInput(event.target.value);
              if (next !== null) setAmount(next);
            }}
            className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
          />
          <button
            type="button"
            className="text-xs text-cyan-glow disabled:opacity-40"
            disabled={holding.balance === undefined || decimals === undefined || tx.pending}
            onClick={() => {
              if (holding.balance !== undefined && decimals !== undefined) setAmount(plainUnits(holding.balance, decimals));
            }}
          >
            Max
          </button>
        </span>
      </label>
      <label className="mt-3 block text-xs text-mist">
        Recipient
        <input
          data-testid="portfolio-send-recipient"
          value={recipientInput}
          placeholder="0x"
          aria-label="Recipient address"
          aria-invalid={recipientInvalid}
          onChange={(event) => setRecipientInput(event.target.value)}
          className={fieldClass}
        />
      </label>
      <p className="mt-3 min-h-5 text-xs leading-5 text-rose-300">{blocker ?? ""}</p>
      <button type="submit" className={`${buttonClass} mt-2 w-full`} disabled={tx.pending || blocker !== null}>
        <TxButtonContent pending={tx.pending} phase={tx.phase} idle={`Send ${symbol}`} />
      </button>
      <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={chainId} />
    </form>
  );
}

function ReceivePanel({
  chainName,
  symbol,
  address,
  onClose,
}: {
  chainName: string;
  symbol: string;
  address: `0x${string}`;
  onClose?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopied(false);
      setCopyError("Could not copy. Select the address and copy it from the page.");
    }
  }

  return (
    <section className="glass-panel rounded-[28px] p-5" data-testid="portfolio-receive">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-frost">Receive {symbol}</h2>
          <p className="mt-1 text-xs leading-5 text-mist">
            Send {symbol} on {chainName} to this wallet. A transfer from another network uses the Bridge page.
          </p>
        </div>
        {onClose ? (
          <button type="button" className="text-xs text-mist" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <QrAddress value={address} />
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-sm text-frost" data-testid="receive-address">
            {address}
          </p>
          <button type="button" data-testid="receive-copy" className="mt-3 text-sm text-cyan-glow" onClick={() => void copyAddress()}>
            {copied ? "Copied" : "Copy address"}
          </button>
          {copyError ? <p className="mt-2 text-xs text-rose-300">{copyError}</p> : null}
          <p className="mt-3 text-xs text-mist">{chainName}</p>
        </div>
      </div>
    </section>
  );
}

const networkFilters = [
  { id: "all", label: "All Networks" },
  { id: "421614", label: "Arbitrum Sepolia" },
  { id: "84532", label: "Base Sepolia" },
  { id: "11155111", label: "Ethereum Sepolia" },
] as const;

type NetworkFilter = (typeof networkFilters)[number]["id"];

const chainTint: Record<number, string> = {
  421614: "bg-cyan-glow/10 text-cyan-glow",
  84532: "bg-violet/15 text-violet",
  11155111: "bg-white/10 text-frost",
};

function TokenMark({ symbol }: { symbol: string }) {
  const letter = symbol.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-glow/10 text-sm font-semibold text-frost">
      {letter}
    </span>
  );
}

type TokenRow = {
  chainId: number;
  network: string;
  holding: Holding;
};

function exactBalance(holding: Holding) {
  if (holding.error) return "Unavailable";
  if (holding.balance === undefined || holding.decimals === undefined) return holding.loading ? "Reading…" : "Unavailable";
  const exact = plainUnits(holding.balance, holding.decimals);
  const dot = exact.indexOf(".");
  const whole = dot === -1 ? exact : exact.slice(0, dot);
  const fraction = dot === -1 ? "" : exact.slice(dot);
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}`;
}

function holdsBalance(holding: Holding) {
  if (holding.error) return true;
  if (holding.balance === 0n) return false;
  return true;
}

function NetworkFilterMenu({ value, onChange }: { value: NetworkFilter; onChange: (next: NetworkFilter) => void }) {
  const current = networkFilters.find((item) => item.id === value) ?? networkFilters[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        data-testid="portfolio-network"
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-medium text-frost outline-none transition hover:border-cyan-glow/40"
      >
        {current.label}
        <ChevronDown className="h-3.5 w-3.5 text-mist" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {networkFilters.map((item) => (
          <DropdownMenuItem
            key={item.id}
            data-testid={`portfolio-network-${item.id}`}
            className={item.id === value ? "text-cyan-glow" : undefined}
            onSelect={() => onChange(item.id)}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HoldingsList({
  rows,
  connected,
  walletChainId,
  busy,
  onSend,
  onReceive,
}: {
  rows: TokenRow[];
  connected: boolean;
  walletChainId: number | undefined;
  busy: boolean;
  onSend: (next: Selection) => void;
  onReceive: (next: Selection) => void;
}) {
  return (
    <div className="mt-2 divide-y divide-white/5">
      {rows.map((row) => {
        const symbol = row.holding.symbol ?? (row.holding.loading ? "Reading…" : shortAddress(row.holding.address));
        const here = walletChainId === row.chainId;
        return (
          <article
            key={`${row.chainId}-${row.holding.address}`}
            className="flex items-center gap-3 py-3.5"
            data-testid={`holding-${row.chainId}-${row.holding.address}`}
          >
            <TokenMark symbol={symbol} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-frost">{symbol}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chainTint[row.chainId] ?? "bg-white/10 text-mist"}`}>
                  {row.network}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <button
                  type="button"
                  className="text-cyan-glow disabled:opacity-40"
                  disabled={busy}
                  onClick={() => onSend({ chainId: row.chainId, token: row.holding.address, mode: "send" })}
                >
                  {connected && !here ? "Switch to send" : "Send"}
                </button>
                <button
                  type="button"
                  className="text-cyan-glow disabled:opacity-40"
                  disabled={busy}
                  onClick={() => onReceive({ chainId: row.chainId, token: row.holding.address, mode: "receive" })}
                >
                  Receive
                </button>
                <AddToWalletButton
                  token={row.holding.address}
                  chainId={row.chainId}
                  className="text-xs text-mist disabled:opacity-40"
                />
              </div>
            </div>
            <p
              className="shrink-0 text-right text-sm font-medium tabular-nums text-frost"
              data-testid={`balance-${row.chainId}-${row.holding.address}`}
            >
              {connected ? exactBalance(row.holding) : "Connect to read"}
              {connected && row.holding.symbol && row.holding.decimals !== undefined ? ` ${row.holding.symbol}` : ""}
            </p>
          </article>
        );
      })}
    </div>
  );
}

export function PortfolioDesk() {
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("tab");
  const tab = requested === "send" || requested === "receive" || requested === "history" ? requested : "assets";
  const { address, chainId, connector, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState<Selection | null>(null);
  const [network, setNetwork] = useState<NetworkFilter>("all");
  const [switchingChain, setSwitchingChain] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const arbitrumBook = useChainHoldings(421614);
  const baseBook = useChainHoldings(84532);
  const ethereumBook = useChainHoldings(11155111);
  const books = [arbitrumBook, baseBook, ethereumBook];
  const shown = pending && chainId === pending.chainId ? pending : pending ? null : selection;
  const connected = Boolean(isConnected && address);
  const filterLabel = networkFilters.find((item) => item.id === network)?.label ?? "All Networks";
  const filteredBooks = books.filter((book) => network === "all" || String(book.chainId) === network);
  const rows = filteredBooks
    .flatMap((book) => {
      const name = bridgeChain(book.chainId)?.name ?? book.network ?? "Network";
      return book.holdings.filter(holdsBalance).map((holding) => ({ chainId: book.chainId, network: name, holding }));
    })
    .sort((left, right) => {
      const symbol = (left.holding.symbol ?? left.holding.address).localeCompare(right.holding.symbol ?? right.holding.address);
      return symbol === 0 ? left.chainId - right.chainId : symbol;
    });
  const stillReading =
    connected &&
    rows.length === 0 &&
    filteredBooks.some((book) => book.loading || book.holdings.some((holding) => holding.loading && holding.balance === undefined));
  const notes = filteredBooks.flatMap((book) => {
    const name = bridgeChain(book.chainId)?.name ?? "This network";
    const lines: string[] = [];
    if (!book.deployed) lines.push(`NixSwap is not deployed on ${name}.`);
    if (book.launchError) lines.push(`Could not read the token list on ${name}.`);
    if (book.bridgeError) lines.push(`The bridge token list on ${name} could not be read.`);
    if (book.bridgeOverflow) lines.push(`${name} lists more bridge tokens than the portfolio can read.`);
    return lines;
  });
  const activeBook = books.find((book) => book.chainId === shown?.chainId);
  const activeHolding = shown ? findHolding(activeBook?.holdings ?? [], shown.token) : undefined;
  const activeChain = bridgeChain(shown?.chainId);
  const activeSymbol = activeHolding?.symbol ?? "tokens";

  async function switchTo(nextChainId: number, next?: Selection) {
    setSwitchError(null);
    setSwitchingChain(true);
    if (next) setPending(next);
    try {
      const provider = await connector?.getProvider();
      if (isWalletProvider(provider)) await switchWalletChain(provider, nextChainId);
      else switchChain({ chainId: nextChainId });
    } catch (error) {
      if (next) setPending(null);
      setSwitchError(errorText(error));
    } finally {
      setSwitchingChain(false);
    }
  }

  function closePanel() {
    setSelection(null);
    setPending(null);
  }

  function openAsset(next: Selection) {
    const current = pending ?? selection;
    if (current && current.chainId === next.chainId && current.token === next.token && current.mode === next.mode) {
      closePanel();
      return;
    }
    if (!connected) {
      openConnectModal?.();
      return;
    }
    if (chainId !== next.chainId) {
      setSelection(null);
      void switchTo(next.chainId, next);
      return;
    }
    setPending(null);
    setSelection(next);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 text-xs leading-5 text-mist">
          Balances are read from this wallet on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia. All Networks lists
          every token with a balance. Pick one network to see only that chain. NIX, bridge-registered tokens, and launched
          tokens appear when those contracts are deployed and the balance read succeeds.
        </p>
        {!isConnected || !address ? (
          <button type="button" className={`${buttonClass} mt-4`} onClick={() => openConnectModal?.()}>
            Connect wallet
          </button>
        ) : chainId !== undefined && !bridgeChain(chainId) ? (
          <button
            type="button"
            className={`${buttonClass} mt-4`}
            disabled={switching || switchingChain}
            onClick={() => void switchTo(preferredChainId)}
          >
            Switch network
          </button>
        ) : null}
        {switchError ? <p className="mt-3 text-xs leading-5 text-rose-300">{switchError}</p> : null}
      </section>

      <Tabs
        value={tab}
        onValueChange={(next: string) => {
          router.replace(next === "assets" ? "/portfolio" : `/portfolio?tab=${next}`, { scroll: false });
        }}
      >
        <TabsList>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="send">Send</TabsTrigger>
          <TabsTrigger value="receive">Receive</TabsTrigger>
          <TabsTrigger value="history" data-testid="portfolio-history">
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="assets" className="mt-4 flex flex-col gap-4">
          {network !== "all" && chainId === Number(network) ? <PricedSummary showAllocation /> : null}
          {pending && !shown ? (
            <p className="text-sm text-mist">Switching to {bridgeChain(pending.chainId)?.name ?? "that network"}…</p>
          ) : null}
          {shown?.mode === "receive" && address && activeChain ? (
            <ReceivePanel chainName={activeChain.name} symbol={activeSymbol} address={address} onClose={closePanel} />
          ) : null}
          {shown?.mode === "send" && activeHolding && activeChain ? (
            <SendPanel chainId={shown.chainId} chainName={activeChain.name} holding={activeHolding} onClose={closePanel} />
          ) : null}
          {shown?.mode === "send" && !activeHolding ? (
            <p className="text-sm text-mist">That token is no longer in the on-chain list.</p>
          ) : null}
          <section className="glass-panel rounded-[28px] px-4 py-4 sm:px-5" data-testid="portfolio-holdings">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-frost">Tokens</h2>
                <p className="mt-1 text-[11px] text-mist">
                  {connected && rows.length > 0 ? `${rows.length} with a balance` : filterLabel}
                </p>
              </div>
              <NetworkFilterMenu value={network} onChange={setNetwork} />
            </div>
            {!connected ? (
              <p className="py-8 text-sm text-mist">
                Connect a wallet to read balances on Arbitrum Sepolia, Base Sepolia, and Ethereum Sepolia.
              </p>
            ) : stillReading ? (
              <p className="py-8 text-sm text-mist">Reading balances…</p>
            ) : rows.length === 0 ? (
              <p className="py-8 text-sm text-mist">This wallet has no token balance on {filterLabel}.</p>
            ) : (
              <HoldingsList
                rows={rows}
                connected={connected}
                walletChainId={chainId}
                busy={switching || switchingChain}
                onSend={openAsset}
                onReceive={openAsset}
              />
            )}
            {notes.map((note) => (
              <p key={note} className="mt-2 text-xs leading-5 text-rose-300">
                {note}
              </p>
            ))}
          </section>
        </TabsContent>
        <TabsContent value="send" className="mt-4 flex flex-col gap-4">
          {pending && !shown ? (
            <p className="text-sm text-mist">Switching to {bridgeChain(pending.chainId)?.name ?? "that network"}…</p>
          ) : null}
          {shown?.mode === "send" && activeHolding && activeChain ? (
            <SendPanel chainId={shown.chainId} chainName={activeChain.name} holding={activeHolding} onClose={closePanel} />
          ) : (
            <p className="text-sm text-mist">Choose a token. The wallet switches to that token&apos;s network before the send form opens.</p>
          )}
          <section className="glass-panel rounded-[28px] px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-frost">Choose a token</h2>
              <NetworkFilterMenu value={network} onChange={setNetwork} />
            </div>
            {!connected ? (
              <p className="py-8 text-sm text-mist">Connect a wallet to choose a token.</p>
            ) : stillReading ? (
              <p className="py-8 text-sm text-mist">Reading balances…</p>
            ) : rows.length === 0 ? (
              <p className="py-8 text-sm text-mist">This wallet has no token balance on {filterLabel}.</p>
            ) : (
              <HoldingsList
                rows={rows}
                connected={connected}
                walletChainId={chainId}
                busy={switching || switchingChain}
                onSend={openAsset}
                onReceive={openAsset}
              />
            )}
          </section>
        </TabsContent>
        <TabsContent value="receive" className="mt-4">
          {address && bridgeChain(chainId) ? (
            <ReceivePanel chainName={bridgeChain(chainId)?.name ?? "this network"} symbol="tokens" address={address} />
          ) : (
            <section className="glass-panel rounded-[28px] p-5 text-sm text-mist">
              {isConnected ? "Switch to a NixSwap network to show this wallet's receive address." : "Connect a wallet to show its receive address."}
            </section>
          )}
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryDesk embedded />
        </TabsContent>
      </Tabs>
    </main>
  );
}
