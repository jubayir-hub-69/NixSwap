"use client";

import { Suspense } from "react";
import { IntentForm } from "@/components/IntentForm";

export default function SwapPage() {
  return (
    <Suspense fallback={<main className="px-4 py-10 text-sm text-mist">Loading swap…</main>}>
      <IntentForm title="Swap" intentType={0} />
    </Suspense>
  );
}
