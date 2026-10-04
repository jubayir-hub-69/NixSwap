"use client";

import { useState } from "react";
import { displayLogo } from "@/lib/logo";

export function TokenMark({ symbol, logoURI, size = "md" }: { symbol: string; logoURI?: string; size?: "sm" | "md" }) {
  const letter = symbol.trim().slice(0, 1).toUpperCase() || "?";
  const src = displayLogo(logoURI);
  const [failedSrc, setFailedSrc] = useState<string | undefined>();
  const box = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  if (src && failedSrc !== src) {
    return (
      // The logo host is chosen by the token creator. no-referrer keeps the wallet page off that request.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size === "sm" ? 32 : 40}
        height={size === "sm" ? 32 : 40}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        className={`${box} shrink-0 rounded-full bg-cyan-glow/10 object-cover`}
      />
    );
  }
  return (
    <span className={`inline-flex ${box} shrink-0 items-center justify-center rounded-full bg-cyan-glow/10 font-semibold text-frost`}>
      {letter}
    </span>
  );
}
