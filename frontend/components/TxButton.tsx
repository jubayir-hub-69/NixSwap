export function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin motion-reduce:animate-none"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TxButtonContent({
  pending,
  phase,
  idle,
}: {
  pending: boolean;
  phase: string | null;
  idle: string;
}) {
  let label = idle;
  if (pending) {
    if (phase?.includes("Confirming")) label = "Mining…";
    else if (!phase || phase.includes("Signature") || phase.includes("Wallet")) label = "Confirm in wallet…";
    else label = phase;
  }
  return (
    <span className="inline-flex w-full items-center justify-center gap-2">
      {pending ? <Spinner /> : null}
      <span>{label}</span>
    </span>
  );
}
