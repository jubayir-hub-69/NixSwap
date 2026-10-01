"use client";

import { Suspense } from "react";
import { PortfolioDesk } from "@/components/PortfolioDesk";

export default function PortfolioPage() {
  return (
    <Suspense fallback={<main className="px-4 py-10 text-sm text-mist">Loading portfolio…</main>}>
      <PortfolioDesk />
    </Suspense>
  );
}
