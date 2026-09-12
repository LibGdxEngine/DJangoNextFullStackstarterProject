import { LandingPage } from "@/features/landing/components/LandingPage";

export default function Home() {
  return <LandingPage contactEmail={process.env.NEXT_PUBLIC_CONTACT_EMAIL} />;
}
