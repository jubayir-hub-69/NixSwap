"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FaucetButton } from "@/components/FaucetButton";
import { Logo } from "@/components/Logo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
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

function linkClass(active: boolean) {
  return `shrink-0 rounded-full px-2.5 py-1.5 text-sm transition ${
    active
      ? "bg-cyan-glow/10 text-cyan-glow shadow-[inset_0_0_0_1px_rgba(62,240,255,0.28)]"
      : "text-mist hover:bg-white/5 hover:text-frost"
  }`;
}

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = more.some((link) => isActive(pathname, link.href));
  const mobileLinks = [...links, ...more];

  function close() {
    setOpen(false);
  }

  return (
    <header className="glass-bar sticky top-0 z-50">
      <div className="flex h-16 w-full items-center gap-3 px-3 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-0.5 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-testid={`nav-${link.label.toLowerCase()}`}
              className={linkClass(isActive(pathname, link.href))}
            >
              {link.label}
            </Link>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={`shrink-0 rounded-full px-2.5 py-1.5 text-left text-sm outline-none hover:bg-white/5 hover:text-frost data-[state=open]:text-frost ${
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
                  <Link href={link.href} data-testid={`nav-${link.label.toLowerCase()}`}>
                    {link.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-glow/25 text-frost transition hover:border-cyan-glow/70 hover:text-cyan-glow lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-navigation"
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
          <ThemeSwitch />
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
        <nav
          id="mobile-navigation"
          aria-label="Mobile"
          className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-white/10 px-3 py-3 lg:hidden"
        >
          <ul className="grid gap-1">
            {mobileLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={close}
                    data-testid={`mobile-nav-${link.label.toLowerCase()}`}
                    className={`flex min-h-11 items-center rounded-2xl px-3 text-sm ${
                      active ? "bg-cyan-glow/10 text-cyan-glow" : "text-frost hover:bg-white/5"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
