export function Badge({
  children,
  bg,
  fg,
  className = "",
}: {
  children: React.ReactNode;
  bg?: string;
  fg?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ${className}`}
      style={{ background: bg ?? "#EEE8FF", color: fg ?? "#4F22D1" }}
    >
      {children}
    </span>
  );
}
