"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { useAccount, useBalance, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { abis } from "@/config/contracts";
import { RouteCard } from "@/components/RouteCard";
import { TxButtonContent } from "@/components/TxButton";
import { TxNotice } from "@/components/TxNotice";
import { useChainTx } from "@/hooks/useChainTx";
import { useErc20Balance } from "@/hooks/useErc20Balance";
import { useLaunches } from "@/hooks/useLaunches";
import { asBigint, decimalInput, formatBalance, formatUnits, parseUnits, plainUnits } from "@/lib/amount";
import { addressFromPeer, bridgeChain, bridgeChains, parseWalletAddress } from "@/lib/bridge";
import { errorText, liveReadQuery, preferredChainId } from "@/lib/deployment";

const fieldClass = "mt-1 w-full rounded-2xl border border-white/10 bg-ink px-3 py-3 text-sm text-frost";
const buttonClass = "btn-primary min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-semibold";

export function OftBridge() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const launches = useLaunches();
  const tx = useChainTx();
  const source = bridgeChain(launches.chainId);
  const [destId, setDestId] = useState<number>(84532);
  const [tokenChoice, setTokenChoice] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [recipientInput, setRecipientInput] = useState("");

  const choices = bridgeChains.filter((chain) => chain.chainId !== source?.chainId);
  const destination = choices.find((chain) => chain.chainId === destId) ?? choices[0];

  const eidQuery = useReadContracts({
    contracts: launches.rows.map((row) => ({
      address: row.token,
      abi: abis.LaunchToken,
      functionName: "localEid" as const,
      chainId: launches.chainId,
    })),
    query: { enabled: Boolean(launches.chainId && launches.rows.length > 0), ...liveReadQuery },
  });
  const oftRows = useMemo(() => {
    if (!source) return [];
    return launches.rows.filter((row, index) => {
      const item = eidQuery.data?.[index];
      // A launch is listed as soon as the launchpad returns it. Hide it only after its endpoint id is known and does not match.
      if (!item || item.status !== "success") return true;
      return Number(item.result) === source.eid;
    });
  }, [eidQuery.data, launches.rows, source]);
  const selected = oftRows.find((row) => row.token === tokenChoice) ?? oftRows[0];
  const balance = useErc20Balance(selected?.token, address, source?.chainId);
  const parsed = selected ? parseUnits(amount, balance.decimals) : null;
  const recipient = recipientInput.trim() === "" ? (address ?? null) : parseWalletAddress(recipientInput);
  const recipientInvalid = recipientInput.trim() !== "" && recipient === null;

  const peer = useReadContract({
    address: selected?.token,
    abi: abis.LaunchToken,
    functionName: "peers",
    args: destination ? [destination.eid] : undefined,
    chainId: source?.chainId,
    query: { enabled: Boolean(selected && destination && source), ...liveReadQuery },
  });
  const peerAddress = addressFromPeer(peer.data) ?? undefined;
  const remoteEid = useReadContract({
    address: peerAddress,
    abi: abis.LaunchToken,
    functionName: "localEid",
    chainId: destination?.chainId,
    query: { enabled: Boolean(peerAddress && destination), ...liveReadQuery },
  });
  const linked = Boolean(destination && remoteEid.isSuccess && Number(remoteEid.data) === destination.eid);
  const quoteEnabled = Boolean(linked && destination && recipient && parsed && parsed > 0n);
  const quote = useReadContract({
    address: selected?.token,
    abi: abis.LaunchToken,
    functionName: "quoteSend",
    args: destination && recipient && parsed ? [destination.eid, recipient, parsed] : undefined,
    chainId: source?.chainId,
    query: { enabled: quoteEnabled, ...liveReadQuery },
  });
  const fee = asBigint(quote.data);
  const feeValue = fee === undefined ? undefined : (fee * 11n) / 10n;
  const native = useBalance({
    address,
    chainId: source?.chainId,
    query: { enabled: Boolean(address && source && quoteEnabled), ...liveReadQuery },
  });

  const eidPending = launches.rows.length > 0 && oftRows.length === 0 && (eidQuery.isLoading || eidQuery.data === undefined);
  let status: string | null = null;
  let blocker: string | null = null;
  if (!isConnected || !address) status = null;
  else if (!source) status = "Switch to a NixSwap network to bridge a launched token.";
  else if (launches.loading || eidPending) status = "Reading launched tokens…";
  else if (launches.error && oftRows.length === 0) blocker = errorText(launches.error);
  else if (oftRows.length === 0) status = "No launched token on this network reports an omnichain endpoint id.";
  else if (!selected || !destination) blocker = "Choose a token and a destination.";
  else if (peer.isLoading) status = "Reading the token peer…";
  else if (peer.isError) blocker = "The token peer could not be read.";
  else if (!peerAddress) status = `This token has no peer on ${destination.name} yet. Relay the launch so the solver can link it.`;
  else if (remoteEid.isLoading) status = `Checking the peer token on ${destination.name}…`;
  else if (remoteEid.isError || !linked) status = `The peer token is not deployed on ${destination.name} yet.`;
  else if (balance.loading) status = "Reading this token balance…";
  else if (balance.error || balance.value === undefined) blocker = "This token balance is unavailable.";
  else if (recipientInvalid) blocker = "Enter a valid recipient. The zero address cannot receive tokens.";
  else if (!recipient) blocker = "Connect a wallet, or enter the address that should receive the minted tokens.";
  else if (amount.trim() === "") status = "Enter an amount.";
  else if (parsed === null) blocker = `Use at most ${balance.decimals} decimal places.`;
  else if (parsed === 0n) blocker = "Enter an amount greater than zero.";
  else if (parsed > balance.value) {
    blocker = `This wallet holds ${formatUnits(balance.value, balance.decimals)} ${selected.symbol}, which is less than ${formatUnits(parsed, balance.decimals)} ${selected.symbol}.`;
  } else if (quote.isLoading || fee === undefined || feeValue === undefined) status = "Reading the LayerZero fee…";
  else if (quote.isError) blocker = errorText(quote.error);
  else if (native.isLoading || native.data?.value === undefined) status = "Reading the ETH balance for the bridge fee…";
  else if (native.isError) blocker = "Could not read the ETH balance for the bridge fee.";
  else if (native.data.value < feeValue) {
    blocker = `The LayerZero fee is ${formatUnits(feeValue, 18, 8)} ETH. This wallet has ${formatUnits(native.data.value, 18, 8)} ETH.`;
  }

  const ready =
    blocker === null &&
    status === null &&
    Boolean(isConnected && source && selected && destination && recipient && parsed && feeValue !== undefined);
  const busy = tx.pending || switching;

  async function bridgeTokens() {
    if (!ready || !selected || !source || !destination || !recipient || !parsed || feeValue === undefined) return;
    await tx.submit(() =>
      tx.writeContractAsync({
        address: selected.token,
        abi: abis.LaunchToken,
        functionName: "send",
        args: [destination.eid, recipient, parsed],
        value: feeValue,
        chainId: source.chainId,
      }),
    );
    setAmount("");
    await balance.refetch();
  }

  return (
    <section className="glass-panel rounded-[28px] p-5" data-testid="oft-bridge">
      <h2 className="text-sm font-semibold text-frost">Burn and mint</h2>
      <p className="mt-1 text-xs leading-5 text-mist">
        A launched token that reports this network&apos;s endpoint id burns here and mints on the destination. This
        path does not approve the lock bridge and does not use escrow.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (!isConnected) openConnectModal?.();
          else if (!source) switchChain({ chainId: preferredChainId });
          else if (ready) void bridgeTokens();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-mist">
            Token
            <select
              data-testid="oft-token"
              className={fieldClass}
              value={selected?.token ?? ""}
              disabled={!selected || busy}
              onChange={(event) => setTokenChoice(event.target.value)}
            >
              {oftRows.length === 0 ? <option value="">No omnichain token</option> : null}
              {oftRows.map((row) => (
                <option key={row.token} value={row.token}>
                  {row.symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-mist">
            To
            <select
              data-testid="oft-destination"
              className={fieldClass}
              value={destination?.chainId ?? ""}
              disabled={!destination || busy}
              onChange={(event) => setDestId(Number(event.target.value))}
            >
              {choices.map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field-well block rounded-3xl px-4 py-3">
          <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-mist">
            <span>Amount</span>
            <span>
              {formatBalance(Boolean(address && selected), balance.loading, balance.error, balance.value, balance.decimals)}
              {selected ? ` ${selected.symbol}` : ""}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <input
              data-testid="oft-amount"
              value={amount}
              inputMode="decimal"
              placeholder="0"
              aria-label="Omnichain amount"
              onChange={(event) => {
                const next = decimalInput(event.target.value);
                if (next !== null) setAmount(next);
              }}
              className="w-full bg-transparent text-3xl text-frost outline-none placeholder:text-white/20"
            />
            <button
              type="button"
              className="text-xs text-cyan-glow disabled:opacity-40"
              disabled={balance.value === undefined || busy}
              onClick={() => {
                if (balance.value !== undefined) setAmount(plainUnits(balance.value, balance.decimals));
              }}
            >
              Max
            </button>
          </span>
        </label>
        <label className="block text-xs text-mist">
          Recipient
          <input
            data-testid="oft-recipient"
            value={recipientInput}
            placeholder={address ?? "0x"}
            aria-label="Omnichain recipient"
            aria-invalid={recipientInvalid}
            onChange={(event) => setRecipientInput(event.target.value)}
            className={fieldClass}
          />
        </label>
        <p className="text-xs text-mist">Leave the recipient blank to mint to the connected wallet.</p>
        <p className="text-xs text-mist" data-testid="oft-fee">
          {feeValue === undefined
            ? linked
              ? "LayerZero fee appears after an amount is entered."
              : ""
            : `You pay ${formatUnits(feeValue, 18, 8)} ETH. Extra above the quote is refunded.`}
        </p>
        <RouteCard
          testId="oft-route"
          mode="Burn and mint"
          from={source?.name}
          to={destination?.name}
          fromChainId={source?.chainId}
          token={selected?.symbol}
          amount={parsed ? formatUnits(parsed, balance.decimals) : undefined}
          quotedFee={fee !== undefined ? `${formatUnits(fee, 18, 8)} ETH` : undefined}
          walletFee={feeValue !== undefined ? `${formatUnits(feeValue, 18, 8)} ETH` : undefined}
        />
        {status ? <p className="min-h-5 text-xs leading-5 text-mist">{status}</p> : null}
        <p className="min-h-5 text-xs leading-5 text-rose-300" data-testid="oft-error">
          {blocker ?? ""}
        </p>
        <button
          type="submit"
          data-testid="oft-submit"
          className={buttonClass}
          disabled={busy || (Boolean(isConnected && source) && !ready)}
          aria-busy={tx.pending}
        >
          <TxButtonContent
            pending={tx.pending}
            phase={tx.phase}
            idle={!isConnected ? "Connect wallet" : !source ? "Switch network" : `Bridge ${selected?.symbol ?? "token"}`}
          />
        </button>
        <TxNotice phase={tx.phase} error={tx.error} hash={tx.hash} chainId={source?.chainId} />
      </form>
    </section>
  );
}
