"use client";

import { Suspense } from "react";
import { SendDesk } from "@/components/SendDesk";

export default function SendPage() {
  return (
    <Suspense fallback={null}>
      <SendDesk />
    </Suspense>
  );
}
