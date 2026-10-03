import Image from "next/image";
import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" aria-label="NixSwap" className="inline-flex shrink-0 items-center">
      <Image
        src="/logo.png"
        alt="NixSwap"
        width={672}
        height={184}
        priority
        className="h-6 w-auto sm:h-8 lg:h-9"
      />
    </Link>
  );
}
