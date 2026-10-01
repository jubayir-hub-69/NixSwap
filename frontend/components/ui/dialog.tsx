"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";

export function Dialog({ children, ...props }: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>;
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={`glass-panel fixed top-1/2 left-1/2 z-50 max-h-[min(100%-2rem,40rem)] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[28px] p-5 outline-none ${className ?? ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <DialogPrimitive.Title className="text-base font-semibold text-frost">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="text-xs text-mist hover:text-frost" aria-label="Close">
            Close
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        <div className="mt-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
