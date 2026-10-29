export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  tone = "light",
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "start" | "between";
  tone?: "light" | "dark";
}) {
  const alignClass =
    align === "center"
      ? "text-center mx-auto max-w-3xl"
      : align === "between"
      ? "flex flex-wrap items-end justify-between gap-6"
      : "";

  const muted = tone === "dark" ? "text-[#C9C4DE]" : "text-muted";

  if (align === "between") {
    return (
      <div className={alignClass}>
        <div>
          <div className="text-sm font-semibold text-violet">{eyebrow}</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-bold leading-tight">{title}</h2>
        </div>
        {description ? (
          <div className={`max-w-md text-[17px] leading-relaxed ${muted}`}>{description}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={alignClass}>
      <div className="text-sm font-semibold text-violet">{eyebrow}</div>
      <h2 className="mt-3 text-4xl md:text-5xl font-bold leading-tight text-balance">{title}</h2>
      {description ? (
        <p className={`mt-4 text-lg leading-relaxed ${muted}`}>{description}</p>
      ) : null}
    </div>
  );
}
