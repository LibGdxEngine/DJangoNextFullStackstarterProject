import type { Metadata } from "next";
import { TeamRoster } from "@/features/wasel/dashboard/TeamRoster";

export const metadata: Metadata = { title: "فريقك" };

export default function TeamPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12 md:px-8">
      <h1 className="text-4xl font-bold">فريقك</h1>
      <p className="mt-2.5 text-base text-muted">
        لكل موظف هوية ومتصفح وذاكرة خاصة. كلّف من تشاء مباشرة، أو دع واصل يختار.
      </p>
      <TeamRoster />
    </div>
  );
}
