"use client";

import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={8}
        className={`glass-panel z-50 min-w-40 rounded-2xl p-1 outline-none ${className ?? ""}`}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={`cursor-pointer rounded-xl px-3 py-2 text-sm text-frost outline-none data-[highlighted]:bg-white/10 ${className ?? ""}`}
      {...props}
    />
  );
}
