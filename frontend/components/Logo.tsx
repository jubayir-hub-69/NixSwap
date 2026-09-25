import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 text-frost">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="nixswap-mark" x1="4" y1="2" x2="28" y2="30">
            <stop offset="0" stopColor="#3ef0ff" />
            <stop offset="1" stopColor="#7c5cff" />
          </linearGradient>
        </defs>
        <rect
          x="1.5"
          y="1.5"
          width="29"
          height="29"
          rx="9"
          fill="#071018"
          stroke="url(#nixswap-mark)"
        />
        <path
          d="M9 23V9h3.1l7.7 9.1V9H23v14h-3.1l-7.7-9.1V23H9Z"
          fill="url(#nixswap-mark)"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">NixSwap</span>
    </Link>
  );
}
