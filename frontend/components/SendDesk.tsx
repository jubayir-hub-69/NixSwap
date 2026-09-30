"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useErc20Balance } from "@/hooks/useErc20Balance";
import { asBigint, decimalInput, formatBalance, formatUnits, parseUnits, plainUnits } from "@/lib/amount";
import { bridgeChain, bridgeChains, parseWalletAddress } from "@/lib/bridge";
import { deploymentFor, liveReadQuery, optionalAddress, preferredChainId } from "@/lib/deployment";

const fieldClass = "mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost";
const buttonClass =
  "min-h-12 w-full rounded-2xl bg-cyan-glow px-4 py-3 text-sm font-semibold text-void shadow-glow disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";

export function SendDesk() {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const tx = useChainTx();
  const source = bridgeChain(chainId);
  const nix = optionalAddress(deploymentFor(source?.chainId), "NixToken");
  const [mode, setMode] = useState<"nix" | "custom">("nix");
  const [custom, setCustom] = useState("");
  const [amount, setAmount] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const customParsed = parseWalletAddress(custom);
  const usingNix = mode === "nix" && Boolean(nix);
  const customInvalid = !usingNix && custom.trim() !== "" && customParsed === null;
  const token = usingNix ? nix : (customParsed ?? undefined);
  const enabled = Boolean(token && source);

  const decimalsQuery = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: source?.chainId,
    query: { enabled },
  });
  const symbolQuery = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "symbol",
    chainId: source?.chainId,
    query: { enabled, staleTime: 60_000 },
  });
  const balanceQuery = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: source?.chainId,
    query: { enabled: Boolean(enabled && address), ...liveReadQuery },
  });
  const nixBalance = useErc20Balance(nix, address, source?.chainId);

  const decimals = typeof decimalsQuery.data === "number" ? decimalsQuery.data : undefined;
  const symbol =
    symbolQuery.isSuccess && typeof symbolQuery.data === "string" && symbolQuery.data.trim()
      ? symbolQuery.data.trim()
      : "ERC-20";
  const balance = asBigint(balanceQuery.data);
  const parsed = decimals === undefined ? null : parseUnits(amount, decimals);
  const recipient = parseWalletAddress(recipientInput);
  const recipientInvalid = recipientInput.trim() !== "" && recipient === null;

  let blocker: string | null = null;
  let action: "connect" | "switch" | "send" | null = null;
  if (!isConnected) action = "connect";
  else if (!source) {
    action = "switch";
    blocker = "Switch to Arbitrum Sepolia, Base Sepolia, or Ethereum Sepolia before sending.";
  } else if (!usingNix && custom.trim() === "") {
    blocker = nix
      ? "Enter the token contract address."
      : `NIX is not deployed on ${source.name}. Enter an ERC-20 contract address.`;
  } else if (!usingNix && !customParsed) blocker = "That is not a valid token contract address.";
  else if (decimalsQuery.isLoading || symbolQuery.isLoading) blocker = "Reading the token…";
  else if (decimalsQuery.isError || decimals === undefined) blocker = "No ERC-20 was found at that address on this network.";
  else if (recipientInvalid || recipientInput.trim() === "") blocker = "Enter the wallet address that should receive the tokens.";
  else if (!recipient) blocker = "Enter a valid recipient address. The zero address cannot receive tokens.";
  else if (amount.trim() === "") blocker = "Enter an amount.";
  else if (parsed === null) blocker = `Use at most ${decimals} decimal places.`;
  else if (parsed === 0n) blocker = "Enter an amount greater than zero.";
  else if (balanceQuery.isLoading) blocker = "Reading your balance…";
  else if (balanceQuery.isError || balance === undefined) blocker = "Could not read your token balance on this network.";
  else if (parsed > balance) {
    blocker = `This wallet holds ${formatUnits(balance, decimals)} ${symbol}, which is less than ${formatUnits(parsed, decimals)} ${symbol}.`;
  } else action = "send";

  const busy = tx.pending || switching;

  async function send() {
    if (!token || !source || !recipient || parsed === null) return;
    await tx.submit(() =>
      tx.writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient, parsed],
        chainId: source.chainId,
      }),
    );
    await balanceQuery.refetch();
  }

  async function copyAddress() {
    if (!address) return;
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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10 sm:py-14">
      <section className="glass-panel rounded-[28px] p-5">
        <h1 className="text-lg font-semibold tracking-tight">Send</h1>
        <p className="mt-1 text-xs leading-5 text-mist">
          Send NIX or another ERC-20 from this wallet to an address on the same network. The wallet signs a standard
          token transfer.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if (action === "connect") openConnectModal?.();
            else if (action === "switch") switchChain({ chainId: preferredChainId });
            else if (action === "send") void send();
          }}
        >
          <label className="block text-xs text-mist">
            Token
            <select
              data-testid="send-token"
              className={fieldClass}
              value={usingNix ? "nix" : "custom"}
              disabled={busy}
              onChange={(event) => setMode(event.target.value === "nix" ? "nix" : "custom")}
            >
              <option value="nix" disabled={!nix}>
                {nix ? "NIX" : "NIX is not on this network"}
              </option>
              <option value="custom">Another ERC-20</option>
            </select>
          </label>
          {!usingNix ? (
            <label className="block text-xs text-mist">
              Token contract
              <input
                data-testid="send-custom-token"
                value={custom}
                placeholder="0x"
                aria-label="Token contract address"
                aria-invalid={customInvalid}
                onChange={(event) => setCustom(event.target.value.trim())}
                className={fieldClass}
              />
            </label>
          ) : null}
          <label className="field-well block rounded-3xl px-4 py-3">
            <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
              <span>Amount</span>
              <span>
                {formatBalance(Boolean(address && token), balanceQuery.isLoading, balanceQuery.isError, balance, decimals ?? 18)}
                {decimals !== undefined ? ` ${symbol}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <input
                data-testid="send-amount"
                value={amount}
                inputMode="decimal"
                placeholder="0"
                aria-label="Send amount"
                onChange={(event) => {
                  const next = decimalInput(event.target.value);
                  if (next !== null) setAmount(next);
                }}
                className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
              />
              <button
                type="button"
                className="text-xs text-cyan-glow disabled:opacity-40"
                disabled={balance === undefined || decimals === undefined || busy}
                onClick={() => {
                  if (balance !== undefined && decimals !== undefined) setAmount(plainUnits(balance, decimals));
                }}
              >
                Max
              </button>
            </span>
          </label>
          <label className="block text-xs text-mist">
            Recipient
            <input
              data-testid="send-recipient"
              value={recipientInput}
              placeholder="0x"
              aria-label="Recipient address"
              aria-invalid={recipientInvalid}
              onChange={(event) => setRecipientInput(event.target.value)}
              className={fieldClass}
            />
          </label>
          <p className="text-xs text-mist">
            {source ? `This transfer stays on ${source.name}.` : "Connect a wallet on a NixSwap network."}
          </p>
          <p className="min-h-5 text-xs leading-5 text-rose-300" data-testid="send-error">
            {action === "connect" || action === "send" ? "" : blocker}
          </p>
          <button
            type="submit"
            data-testid="send-submit"
            className={buttonClass}
            disabled={busy || (isConnected && action === null)}
            aria-busy={tx.pending}
          >
            <TxButtonContent
              pending={tx.pending}
              phase={tx.phase}
              idle={action === "connect" ? "Connect wallet" : action === "switch" ? "Switch network" : `Send ${symbol}`}
            />
          </button>
          <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={source?.chainId} />
        </form>
      </section>

      <section className="glass-panel rounded-[28px] p-5" data-testid="receive-panel">
        <h2 className="text-sm font-semibold text-frost">Receive</h2>
        <p className="mt-1 text-xs leading-5 text-mist">
          Tokens sent to this address on the connected network arrive in this wallet. Bridging from another network uses
          the Bridge page.
        </p>
        {!isConnected || !address ? (
          <button type="button" className={`${buttonClass} mt-4`} onClick={() => openConnectModal?.()}>
            Connect wallet
          </button>
        ) : (
          <>
            <p className="mt-4 break-all font-mono text-sm text-frost" data-testid="receive-address">
              {address}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <button type="button" data-testid="receive-copy" className="text-cyan-glow" onClick={() => void copyAddress()}>
                {copied ? "Copied" : "Copy address"}
              </button>
              <span className="text-mist">{source?.name ?? "Unsupported network"}</span>
            </div>
            {copyError ? <p className="mt-2 text-xs text-rose-300">{copyError}</p> : null}
            <p className="mt-4 text-sm text-frost" data-testid="receive-nix-balance">
              {!source
                ? "Switch to a NixSwap network to read NIX."
                : !nix
                  ? `NIX is not deployed on ${source.name}.`
                  : `NIX balance: ${formatBalance(true, nixBalance.loading, nixBalance.error, nixBalance.value, nixBalance.decimals)}`}
            </p>
            {!source ? (
              <button
                type="button"
                className={`${buttonClass} mt-4`}
                disabled={switching}
                onClick={() => switchChain({ chainId: preferredChainId })}
              >
                Switch network
              </button>
            ) : null}
          </>
        )}
        <p className="mt-4 text-[11px] leading-5 text-mist">
          Supported networks: {bridgeChains.map((chain) => chain.name).join(", ")}.
        </p>
      </section>
    </main>
  );
}
