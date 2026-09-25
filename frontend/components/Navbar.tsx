"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";

const links = [
  { href: "/", label: "Swap" },
  { href: "/pool", label: "Pool" },
  { href: "/trade", label: "Trade" },
  { href: "/launch", label: "Launch" },
];

function NavLinks({
  pathname,
  onNavigate,
  className,
}: {
  pathname: string;
  onNavigate?: () => void;
  className: string;
}) {
  return (
    <div className={className}>
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            data-testid={`nav-${link.label.toLowerCase()}`}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              active
                ? "bg-cyan-glow/10 text-cyan-glow shadow-[inset_0_0_0_1px_rgba(62,240,255,0.28)]"
                : "text-mist hover:bg-white/5 hover:text-frost"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="glass-bar sticky top-0 z-50">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />
        <NavLinks
          pathname={pathname}
          className="hidden items-center gap-1 md:flex"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-frost md:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            data-testid="mobile-menu"
            onClick={() => setOpen((value) => !value)}
          >
            <span className="flex w-4 flex-col gap-1">
              <span className={`block h-px bg-current transition ${open ? "translate-y-[5px] rotate-45" : ""}`} />
              <span className={`block h-px bg-current transition ${open ? "opacity-0" : ""}`} />
              <span className={`block h-px bg-current transition ${open ? "-translate-y-[5px] -rotate-45" : ""}`} />
            </span>
          </button>
          <ConnectButton
            label="Connect"
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            chainStatus={{ smallScreen: "icon", largeScreen: "full" }}
            showBalance={false}
          />
        </div>
      </div>
      {open ? (
        <NavLinks
          pathname={pathname}
          onNavigate={() => setOpen(false)}
          className="mx-auto grid w-full max-w-6xl gap-1 px-4 pb-4 md:hidden"
        />
      ) : null}
    </header>
  );
}
