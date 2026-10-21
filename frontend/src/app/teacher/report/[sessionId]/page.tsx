import { LessonReportForm } from "@/features/academy/teacher/LessonReportForm";

export default async function LessonReportPage(props: PageProps<"/teacher/report/[sessionId]">) {
  const { sessionId } = await props.params;
  return <LessonReportForm sessionId={sessionId} />;
}
