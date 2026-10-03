"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

function subscribeHydration() {
  return () => {};
}

function useHydrated() {
  return useSyncExternalStore(subscribeHydration, () => true, () => false);
}

const options = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const mode = hydrated && (theme === "light" || theme === "system" || theme === "dark") ? theme : "dark";
  const Active = options.find((option) => option.id === mode)?.icon ?? Moon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label="Theme"
        data-testid="theme-switch"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-glow/25 text-frost outline-none transition hover:border-cyan-glow/70 hover:text-cyan-glow"
      >
        <Active className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => {
          const Icon = option.icon;
          const selected = mode === option.id;
          return (
            <DropdownMenuItem
              key={option.id}
              data-testid={`theme-${option.id}`}
              className={selected ? "text-cyan-glow" : undefined}
              onSelect={() => setTheme(option.id)}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {option.label}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
