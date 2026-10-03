import Link from "next/link";

const product = [
  { href: "/swap", label: "Swap" },
  { href: "/bridge", label: "Bridge" },
  { href: "/pool", label: "Pool" },
  { href: "/launch", label: "Launch" },
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/docs", label: "Docs" },
];

const legal = [
  { href: "https://x.com/NixSwap", label: "Twitter", external: true },
  { href: "/privacy", label: "Privacy Policy", external: false },
  { href: "/terms", label: "Terms of Service", external: false },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/10">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:px-6">
        <div>
          <p className="text-sm font-semibold tracking-tight text-frost">NixSwap</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-mist">
            Testnet exchange for confidential swaps, LayerZero bridging, and NIX liquidity on Arbitrum Sepolia,
            Base Sepolia, and Ethereum Sepolia.
          </p>
        </div>
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-mist">Links</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {product.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-frost hover:text-cyan-glow">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-mist">Legal</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {legal.map((item) => (
              <li key={item.href}>
                {item.external ? (
                  <a href={item.href} className="text-frost hover:text-cyan-glow" target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ) : (
                  <Link href={item.href} className="text-frost hover:text-cyan-glow">
                    {item.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="px-4 pb-8 text-center text-xs text-mist">NixSwap testnet software. Assets on these networks have no mainnet value.</p>
    </footer>
  );
}
