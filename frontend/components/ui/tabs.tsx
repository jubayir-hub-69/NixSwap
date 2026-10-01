"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={`flex flex-wrap gap-1 rounded-full border border-white/10 bg-black/30 p-1 ${className ?? ""}`}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={`min-h-9 rounded-full px-3 py-1.5 text-sm text-mist outline-none transition hover:text-frost focus-visible:ring-2 focus-visible:ring-cyan-glow/50 data-[state=active]:bg-cyan-glow data-[state=active]:font-semibold data-[state=active]:text-void ${className ?? ""}`}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={`outline-none ${className ?? ""}`} {...props} />;
}
