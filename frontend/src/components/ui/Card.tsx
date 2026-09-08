import React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
}

export function Card({
  title,
  subtitle,
  headerAction,
  children,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur-sm shadow-sm",
        className
      )}
      {...props}
    >
      {(title || headerAction) && (
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80">
          <div>
            {title && (
              <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
            )}
            {subtitle && (
              <p className="text-sm text-zinc-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
