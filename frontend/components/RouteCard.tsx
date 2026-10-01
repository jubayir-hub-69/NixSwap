import { LAYERZERO_TESTNET_ENDPOINT } from "@/lib/bridge";
import { addressUrl } from "@/lib/deployment";
import { shortAddress } from "@/lib/markets";

export function RouteCard({
  testId,
  mode,
  from,
  to,
  fromChainId,
  token,
  amount,
  quotedFee,
  walletFee,
}: {
  testId: string;
  mode: "Lock and release" | "Burn and mint";
  from?: string;
  to?: string;
  fromChainId?: number;
  token?: string;
  amount?: string;
  quotedFee?: string;
  walletFee?: string;
}) {
  const endpointUrl = addressUrl(fromChainId, LAYERZERO_TESTNET_ENDPOINT);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3" data-testid={testId}>
      <p className="text-[11px] uppercase tracking-wide text-mist">Route</p>
      <ol className="mt-2 space-y-2 text-sm text-frost">
        <li>1. {from ?? "Source network"} · {mode === "Lock and release" ? "Lock" : "Burn"} {amount ? `${amount} ` : ""}{token ?? "the token"}</li>
        <li>
          2. LayerZero V2 ·{" "}
          {endpointUrl ? (
            <a href={endpointUrl} target="_blank" rel="noreferrer" className="text-cyan-glow">
              {shortAddress(LAYERZERO_TESTNET_ENDPOINT)}
            </a>
          ) : (
            shortAddress(LAYERZERO_TESTNET_ENDPOINT)
          )}
        </li>
        <li>3. {to ?? "Destination network"} · {mode === "Lock and release" ? "Release from escrow" : "Mint to the recipient"}</li>
      </ol>
      <dl className="mt-3 space-y-1 text-xs text-mist">
        <div className="flex justify-between gap-3">
          <dt>Quoted fee</dt>
          <dd className="text-right text-frost">{quotedFee ?? "Quoted after the amount and route pass the contract checks."}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Wallet sends</dt>
          <dd className="text-right text-frost">{walletFee ?? "The wallet adds a buffer above the quote. Unused ETH is refunded."}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Estimated time</dt>
          <dd className="max-w-[16rem] text-right text-frost">
            quoteSend returns the native fee for this route. It does not return a clock time.
          </dd>
        </div>
      </dl>
    </div>
  );
}
