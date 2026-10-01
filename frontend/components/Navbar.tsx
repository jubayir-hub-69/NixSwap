"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FaucetButton } from "@/components/FaucetButton";
import { Logo } from "@/components/Logo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const links = [
  { href: "/swap", label: "Swap" },
  { href: "/bridge", label: "Bridge" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/markets", label: "Markets" },
  { href: "/launch", label: "Launch" },
  { href: "/pool", label: "Pool" },
];

const more = [{ href: "/docs", label: "Docs" }];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  pathname,
  onNavigate,
  className,
}: {
  pathname: string;
  onNavigate?: () => void;
  className: string;
}) {
  const moreActive = more.some((link) => isActive(pathname, link.href));
  return (
    <div className={className}>
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            data-testid={`nav-${link.label.toLowerCase()}`}
            className={`shrink-0 rounded-full px-2 py-1.5 text-sm transition ${
              active
                ? "bg-cyan-glow/10 text-cyan-glow shadow-[inset_0_0_0_1px_rgba(62,240,255,0.28)]"
                : "text-mist hover:bg-white/5 hover:text-frost"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={`shrink-0 rounded-full px-2 py-1.5 text-left text-sm outline-none hover:bg-white/5 hover:text-frost data-[state=open]:text-frost ${
            moreActive ? "bg-cyan-glow/10 text-cyan-glow shadow-[inset_0_0_0_1px_rgba(62,240,255,0.28)]" : "text-mist"
          }`}
          data-testid="nav-more"
          type="button"
        >
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {more.map((link) => (
            <DropdownMenuItem key={link.href} asChild>
              <Link href={link.href} onClick={onNavigate} data-testid={`nav-${link.label.toLowerCase()}`}>
                {link.label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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
          className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-glow/25 text-frost transition hover:border-cyan-glow/70 hover:text-cyan-glow md:hidden"
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
          <FaucetButton />
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
