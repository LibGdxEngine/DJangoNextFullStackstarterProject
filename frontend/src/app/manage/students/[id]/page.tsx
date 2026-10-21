import { StudentProfile } from "@/features/academy/students/StudentProfile";

export default async function StudentPage(props: PageProps<"/manage/students/[id]">) {
  const { id } = await props.params;
  return <StudentProfile id={id} />;
}
