import { notFound } from "next/navigation";
import { FamilySectionPlaceholder } from "@/features/academy/SectionPlaceholders";

const SECTIONS = new Set(["schedule", "progress", "payments"]);

export default async function FamilySectionPage(props: PageProps<"/family/[section]">) {
  const { section } = await props.params;
  if (!SECTIONS.has(section)) notFound();
  return <FamilySectionPlaceholder section={section} />;
}
