"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { AddToWalletButton } from "@/components/AddToWalletButton";
import { HistoryDesk } from "@/components/HistoryDesk";
import { PricedSummary } from "@/components/PricedSummary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrAddress } from "@/components/QrAddress";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useChainHoldings, type Holding } from "@/hooks/useChainHoldings";
import { decimalInput, formatBalance, formatUnits, parseUnits, plainUnits } from "@/lib/amount";
import { bridgeChain, bridgeChains, parseWalletAddress } from "@/lib/bridge";
import { errorText, preferredChainId } from "@/lib/deployment";
import { shortAddress } from "@/lib/markets";
import { isWalletProvider, switchWalletChain } from "@/lib/walletChain";

const fieldClass = "mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost";
const buttonClass = "btn-primary min-h-11 rounded-2xl px-4 py-2.5 text-sm font-semibold";
const ghostClass = "btn-ghost min-h-11 rounded-2xl px-4 py-2.5 text-sm";

type Selection = { chainId: number; token: `0x${string}`; mode: "send" | "receive" };

function findHolding(holdings: Holding[], token: `0x${string}`) {
  return holdings.find((item) => item.address.toLowerCase() === token.toLowerCase());
}

function AssetActions({
  chainId,
  holding,
  connectedHere,
  walletConnected,
  busy,
  onSend,
  onReceive,
}: {
  chainId: number;
  holding: Holding;
  connectedHere: boolean;
  walletConnected: boolean;
  busy: boolean;
  onSend: () => void;
  onReceive: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={ghostClass} disabled={busy} onClick={onSend}>
        {connectedHere ? "Send" : walletConnected ? "Switch to send" : "Send"}
      </button>
      <button type="button" className={ghostClass} disabled={busy} onClick={onReceive}>
        Receive
      </button>
      <AddToWalletButton token={holding.address} chainId={chainId} className="min-h-11 rounded-2xl px-2 text-sm text-cyan-glow disabled:opacity-40" />
    </div>
  );
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

function ChainBook({
  chainId,
  walletChainId,
  walletConnected,
  selection,
  busy,
  onSelect,
  onSwitch,
  onConnect,
}: {
  chainId: number;
  walletChainId: number | undefined;
  walletConnected: boolean;
  selection: Selection | null;
  busy: boolean;
  onSelect: (next: Selection) => void;
  onSwitch: (chainId: number, next?: Selection) => void;
  onConnect: () => void;
}) {
  const book = useChainHoldings(chainId);
  const chain = bridgeChain(chainId);
  const connectedHere = walletChainId === chainId;
  const title = chain?.name ?? book.network ?? "Network";

  return (
    <section className="glass-panel rounded-[28px] p-4 sm:p-5" data-testid={`portfolio-${chainId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-frost">{title}</h2>
          <p className="mt-1 text-[11px] text-mist">{connectedHere ? "Connected network" : "Switch here to send"}</p>
        </div>
        {connectedHere ? (
          <span className="rounded-full bg-cyan-glow/10 px-2 py-1 text-[11px] text-cyan-glow">Live</span>
        ) : (
          <button type="button" className={ghostClass} disabled={busy} onClick={() => onSwitch(chainId)}>
            Switch
          </button>
        )}
      </div>
      {!book.deployed ? (
        <p className="mt-4 text-sm text-mist">NixSwap is not deployed on {title}.</p>
      ) : book.loading && book.holdings.length === 0 ? (
        <p className="mt-4 text-sm text-mist">Reading on-chain balances…</p>
      ) : book.launchError && book.holdings.length === 0 ? (
        <p className="mt-4 text-sm text-rose-300">Could not read the token list on {title}.</p>
      ) : book.holdings.length === 0 ? (
        <p className="mt-4 text-sm text-mist">No NIX, bridge token, or launched token is deployed on {title}.</p>
      ) : (
        <div className="mt-4 divide-y divide-white/5">
          {book.holdings.map((holding) => {
            const symbol = holding.symbol ?? (holding.loading ? "Reading…" : shortAddress(holding.address));
            return (
              <article key={holding.address} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-frost">{symbol}</p>
                  <p className="mt-0.5 text-[11px] text-mist">
                    {holding.name ?? "ERC-20"} · {shortAddress(holding.address)}
                  </p>
                </div>
                <p className="text-sm text-frost" data-testid={`balance-${holding.address}`}>
                  {formatBalance(
                    walletConnected,
                    holding.loading,
                    holding.error ||
                      (walletConnected && !holding.loading && (holding.decimals === undefined || holding.balance === undefined)),
                    holding.balance,
                    holding.decimals ?? 18,
                  )}{" "}
                  {holding.decimals !== undefined ? (holding.symbol ?? "") : ""}
                </p>
                <AssetActions
                  chainId={chainId}
                  holding={holding}
                  connectedHere={connectedHere}
                  walletConnected={walletConnected}
                  busy={busy}
                  onSend={() => {
                    if (!walletConnected) onConnect();
                    else if (!connectedHere) onSwitch(chainId, { chainId, token: holding.address, mode: "send" });
                    else onSelect({ chainId, token: holding.address, mode: "send" });
                  }}
                  onReceive={() => {
                    if (!walletConnected) onConnect();
                    else if (!connectedHere) onSwitch(chainId, { chainId, token: holding.address, mode: "receive" });
                    else onSelect({ chainId, token: holding.address, mode: "receive" });
                  }}
                />
              </article>
            );
          })}
        </div>
      )}
      {book.bridgeError ? <p className="mt-2 text-xs text-rose-300">The bridge token list on {title} could not be read.</p> : null}
      {book.bridgeOverflow ? (
        <p className="mt-2 text-xs text-rose-300">This bridge lists more tokens than the portfolio can read.</p>
      ) : null}
      {selection?.chainId === chainId && selection.mode === "send" ? (
        <div className="mt-2">
          {(() => {
            const holding = findHolding(book.holdings, selection.token);
            return holding ? (
              <SendPanel chainId={chainId} chainName={title} holding={holding} onClose={() => onSelect(selection)} />
            ) : (
              <p className="text-sm text-mist">That token is no longer in the on-chain list.</p>
            );
          })()}
        </div>
      ) : null}
    </section>
  );
}

function SendChooser({
  chainId,
  busy,
  onPick,
}: {
  chainId: number;
  busy: boolean;
  onPick: (next: Selection) => void;
}) {
  const book = useChainHoldings(chainId);
  const title = bridgeChain(chainId)?.name ?? book.network ?? "Network";
  return (
    <section className="glass-panel rounded-[28px] p-4">
      <h2 className="text-sm font-semibold text-frost">{title}</h2>
      {book.loading && book.holdings.length === 0 ? <p className="mt-3 text-sm text-mist">Reading on-chain balances…</p> : null}
      {!book.loading && book.holdings.length === 0 ? <p className="mt-3 text-sm text-mist">No token on {title}.</p> : null}
      <div className="mt-3 flex flex-col gap-2">
        {book.holdings.map((holding) => (
          <button
            key={holding.address}
            type="button"
            disabled={busy}
            className="flex items-center justify-between rounded-2xl border border-white/10 px-3 py-3 text-left text-sm text-frost disabled:opacity-40"
            onClick={() => onPick({ chainId, token: holding.address, mode: "send" })}
          >
            <span>{holding.symbol ?? shortAddress(holding.address)}</span>
            <span>
              {formatBalance(
                true,
                holding.loading,
                holding.error,
                holding.balance,
                holding.decimals ?? 18,
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
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
  const [switchingChain, setSwitchingChain] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Open send or receive only after the wallet reports the chain that action needs.
  if (pending && chainId === pending.chainId) {
    setSelection(pending);
    setPending(null);
  }

  async function switchTo(nextChainId: number, next?: Selection) {
    setSwitchError(null);
    setSwitchingChain(true);
    try {
      const provider = await connector?.getProvider();
      if (isWalletProvider(provider)) await switchWalletChain(provider, nextChainId);
      else switchChain({ chainId: nextChainId });
      if (next) setPending(next);
    } catch (error) {
      setSwitchError(errorText(error));
    } finally {
      setSwitchingChain(false);
    }
  }
  const selectedChain = bridgeChain(selection?.chainId);
  const selectedBook = useChainHoldings(selection?.chainId ?? preferredChainId);
  const selectedHolding = selection ? findHolding(selectedBook.holdings, selection.token) : undefined;
  const receiveSymbol = selectedHolding?.symbol ?? "tokens";

  function choose(next: Selection) {
    setSelection((current) =>
      current && current.chainId === next.chainId && current.token === next.token && current.mode === next.mode ? null : next,
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 text-xs leading-5 text-mist">
          Balances are read from the wallet on each NixSwap network. NIX, bridge-registered tokens, and launched tokens
          are included when those contracts are deployed. A token such as OVA is listed only when that chain returns
          its address. Nothing here is a sample balance.
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
          <PricedSummary showAllocation />
          {selection?.mode === "receive" && address && selectedChain ? (
            <ReceivePanel
              chainName={selectedChain.name}
              symbol={receiveSymbol}
              address={address}
              onClose={() => setSelection(null)}
            />
          ) : null}
          {bridgeChains.map((chain) => (
            <ChainBook
              key={chain.chainId}
              chainId={chain.chainId}
              walletChainId={isConnected ? chainId : undefined}
              walletConnected={Boolean(isConnected && address)}
              selection={selection?.mode === "send" ? selection : null}
              busy={switching || switchingChain}
              onSelect={choose}
              onSwitch={(next, follow) => void switchTo(next, follow)}
              onConnect={() => openConnectModal?.()}
            />
          ))}
        </TabsContent>
        <TabsContent value="send" className="mt-4 flex flex-col gap-4">
          {selection?.mode === "send" && selectedHolding && selectedChain ? (
            <SendPanel chainId={selection.chainId} chainName={selectedChain.name} holding={selectedHolding} onClose={() => setSelection(null)} />
          ) : (
            <p className="text-sm text-mist">Choose an asset. The wallet switches to that asset&apos;s network before the send form opens.</p>
          )}
          {bridgeChains.map((chain) => (
            <SendChooser
              key={chain.chainId}
              chainId={chain.chainId}
              busy={switching || switchingChain}
              onPick={(next) => {
                if (!isConnected || !address) openConnectModal?.();
                else if (chainId !== next.chainId) void switchTo(next.chainId, next);
                else setSelection(next);
              }}
            />
          ))}
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
