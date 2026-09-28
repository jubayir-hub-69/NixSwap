"use client";

import { Suspense } from "react";
import { IntentForm } from "@/components/IntentForm";

export default function TradePage() {
  return (
    <Suspense fallback={null}>
      <IntentForm title="Trade" intentType={2} />
    </Suspense>
  );
}
