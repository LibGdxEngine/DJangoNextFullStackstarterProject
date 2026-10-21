import { TeacherProfile } from "@/features/academy/teachers/TeacherProfile";

export default async function TeacherPage(props: PageProps<"/manage/teachers/[id]">) {
  const { id } = await props.params;
  return <TeacherProfile id={id} />;
}
