import { notFound } from "next/navigation";
import { TeacherSectionPlaceholder } from "@/features/academy/SectionPlaceholders";

const SECTIONS = new Set(["schedule", "students", "earnings"]);

export default async function TeacherSectionPage(props: PageProps<"/teacher/[section]">) {
  const { section } = await props.params;
  if (!SECTIONS.has(section)) notFound();
  return <TeacherSectionPlaceholder section={section === "students" ? "students" : section} />;
}
