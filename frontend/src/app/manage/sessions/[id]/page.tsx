import { SessionDetail } from "@/features/academy/sessions/SessionDetail";

export default async function SessionPage(props: PageProps<"/manage/sessions/[id]">) {
  const { id } = await props.params;
  return <SessionDetail id={id} />;
}
