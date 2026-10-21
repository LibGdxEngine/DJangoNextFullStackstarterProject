import { notFound } from "next/navigation";
import { SECTION_STAGE } from "@/features/academy/sections";
import { ManageSectionPlaceholder } from "@/features/academy/SectionPlaceholders";

export default async function ManageSectionPage(props: PageProps<"/manage/[section]">) {
  const { section } = await props.params;
  if (!(section in SECTION_STAGE)) notFound();
  return <ManageSectionPlaceholder section={section} />;
}
