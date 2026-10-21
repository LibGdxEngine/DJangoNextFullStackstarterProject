import { RecurringScheduleForm } from "@/features/academy/schedule/RecurringScheduleForm";

export default async function EditRecurringSchedulePage(props: PageProps<"/manage/schedule/series/[id]">) {
  const { id } = await props.params;
  return <RecurringScheduleForm seriesId={id} />;
}
