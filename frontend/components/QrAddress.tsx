"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrAddress({ value }: { value: string }) {
  const [image, setImage] = useState<{ value: string; svg: string } | null>(null);
  const [failedValue, setFailedValue] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#071018", light: "#f4fbff" },
    })
      .then((markup) => {
        if (!cancelled) setImage({ value, svg: markup });
      })
      .catch(() => {
        if (!cancelled) setFailedValue(value);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const svg = image?.value === value ? image.svg : null;
  if (failedValue === value && svg === null) {
    return <p className="text-xs text-rose-300">The QR code could not be generated. Copy the address instead.</p>;
  }
  if (!svg) {
    return <div className="h-44 w-44 animate-pulse rounded-2xl bg-white/10" aria-hidden="true" />;
  }
  return (
    <div
      className="w-44 overflow-hidden rounded-2xl bg-[#f4fbff] p-2"
      data-testid="receive-qr"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
