"use client";

import { Suspense } from "react";
import { BridgeDesk } from "@/components/BridgeDesk";

export default function BridgePage() {
  return (
    <Suspense fallback={null}>
      <BridgeDesk />
    </Suspense>
  );
}
