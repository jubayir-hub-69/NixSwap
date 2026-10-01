import type { ComponentProps } from "react";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={`w-full min-w-[760px] border-collapse text-left text-sm ${className ?? ""}`} {...props} />;
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={`text-[11px] uppercase tracking-wide text-mist ${className ?? ""}`} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={className} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={`border-t border-white/5 ${className ?? ""}`} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return <th className={`px-3 py-2 font-medium ${className ?? ""}`} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={`px-3 py-3 align-middle ${className ?? ""}`} {...props} />;
}
