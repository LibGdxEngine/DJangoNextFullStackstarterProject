import { FamilyDetail } from "@/features/academy/families/FamilyDetail";

export default async function FamilyPage(props: PageProps<"/manage/families/[id]">) {
  const { id } = await props.params;
  return <FamilyDetail id={id} />;
}
