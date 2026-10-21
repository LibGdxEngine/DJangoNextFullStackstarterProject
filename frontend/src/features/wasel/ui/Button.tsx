import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  violet: "bg-violet text-white hover:bg-violet-dark shadow-[0_10px_30px_rgba(109,59,245,0.35)]",
  amber: "bg-amber text-ink hover:bg-white font-bold",
  white: "bg-white text-ink hover:bg-amber",
  ink: "bg-ink text-white hover:bg-violet",
  outline: "bg-transparent text-ink border border-line hover:border-violet hover:text-violet",
  "outline-light": "bg-transparent text-white border border-white/20 hover:border-white",
  ghost: "bg-transparent text-muted hover:text-ink",
} as const;

const SIZES = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-[15px]",
  lg: "px-8 py-4 text-base",
} as const;

type Variant = keyof typeof VARIANTS;
type Size = keyof typeof SIZES;

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

type ButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

type ButtonAsLink = CommonProps & {
  href: string;
};

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export function Button(props: ButtonAsButton | ButtonAsLink) {
  const { variant = "violet", size = "md", className, children, ...rest } = props;
  const classes = cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors",
    VARIANTS[variant],
    SIZES[size],
    className
  );

  if ("href" in rest && rest.href) {
    return (
      <Link href={rest.href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
