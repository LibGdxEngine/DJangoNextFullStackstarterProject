import { TeacherStatement } from "@/features/academy/money/TeacherStatement";

export default async function StatementPage(props: PageProps<"/manage/payroll/[month]/[teacherId]">) {
  const { month, teacherId } = await props.params;
  return <TeacherStatement month={month} teacherId={teacherId} />;
}
