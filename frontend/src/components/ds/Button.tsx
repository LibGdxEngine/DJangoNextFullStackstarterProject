import React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "tertiary" | "danger" | "danger-solid" | "on-dark" | "on-dark-outline";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand-800 text-white hover:bg-brand-700 border border-transparent",
  secondary: "bg-surface text-ink border border-line hover:bg-page",
  tertiary: "bg-transparent text-brand-700 border border-transparent hover:bg-brand-50",
  danger: "bg-danger-bg text-danger border border-danger-border hover:bg-st-action-bg",
  "danger-solid": "bg-danger text-white border border-transparent hover:bg-st-action",
  "on-dark": "bg-brand-100 text-brand-800 border border-transparent hover:bg-white font-semibold",
  "on-dark-outline": "bg-transparent text-white border border-white/30 hover:bg-white/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px] rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-[10px] gap-2",
  lg: "h-[52px] px-5 text-base rounded-[14px] gap-2 font-semibold",
};

const base = "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:bg-page disabled:text-disabled disabled:border-line-soft";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  /** Renders a visible locked control; pair with `aria-describedby` pointing at the reason. */
  locked?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, locked, className, children, type = "button", disabled, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || locked}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {locked ? <Lock aria-hidden className="size-3.5" /> : icon}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
}

export function ButtonLink({ variant = "secondary", size = "md", icon, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({ label, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn("inline-flex size-10 items-center justify-center rounded-[10px] border border-line bg-surface text-secondary hover:bg-page", className)}
      {...props}
    >
      {children}
    </button>
  );
}
