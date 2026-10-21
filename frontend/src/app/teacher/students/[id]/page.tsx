import { TeacherStudentRecord } from "@/features/academy/teacher/TeacherStudentRecord";

export default async function TeacherStudentPage(props: PageProps<"/teacher/students/[id]">) {
  const { id } = await props.params;
  return <TeacherStudentRecord id={id} />;
}
