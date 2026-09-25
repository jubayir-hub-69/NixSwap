import { transactionUrl } from "@/lib/deployment";

export function TxNotice({
  phase,
  error,
  hash,
  chainId,
}: {
  phase: string | null;
  error: string | null;
  hash: string | null;
  chainId: number | undefined;
}) {
  const href = hash ? transactionUrl(chainId, hash) : undefined;
  return (
    <div aria-live="polite" className="mt-4 min-h-6 text-xs leading-5">
      {phase ? <p className="text-cyan-glow">{phase}</p> : null}
      {error ? <p className="break-words text-rose-300">{error}</p> : null}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-frost underline">
          View transaction
        </a>
      ) : null}
    </div>
  );
}
