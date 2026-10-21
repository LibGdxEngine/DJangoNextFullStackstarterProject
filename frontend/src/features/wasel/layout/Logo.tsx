import Link from "next/link";

export function Logo({ dark = false, href = "/" }: { dark?: boolean; href?: string }) {
  return (
    <Link
      href={href}
      className={`flex items-baseline gap-0.5 text-[26px] font-bold tracking-tight ${
        dark ? "text-white" : "text-ink"
      }`}
    >
      واصل
      <span className="inline-block w-2 h-2 rounded-full bg-amber" />
    </Link>
  );
}
