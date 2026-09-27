"use client";

import { Suspense } from "react";
import { PoolDesk } from "@/components/PoolDesk";

export default function PoolPage() {
  return (
    <Suspense fallback={null}>
      <PoolDesk />
    </Suspense>
  );
}
