import { ConversationView } from "@/features/wasel/dashboard/ConversationView";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConversationView runId={id} />;
}
