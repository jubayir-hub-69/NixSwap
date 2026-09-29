import Image from "next/image";
import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" aria-label="NixSwap" className="inline-flex shrink-0 items-center">
      <span className="relative block h-12 w-[9.5rem] overflow-hidden rounded-lg">
        <Image
          src="/8JwMB.jpg"
          alt="NixSwap"
          fill
          priority
          sizes="152px"
          className="object-cover object-center"
        />
      </span>
    </Link>
  );
}
