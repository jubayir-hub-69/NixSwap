"use client";

import { Suspense } from "react";
import { IntentForm } from "@/components/IntentForm";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <IntentForm title="Swap" intentType={0} />
    </Suspense>
  );
}
