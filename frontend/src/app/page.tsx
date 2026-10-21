import { Hero } from "@/features/wasel/landing/Hero";
import { WallOfRequests } from "@/features/wasel/landing/WallOfRequests";
import { Pipeline } from "@/features/wasel/landing/Pipeline";
import { HowItWorks } from "@/features/wasel/landing/HowItWorks";
import { Examples } from "@/features/wasel/landing/Examples";
import { Differentiators } from "@/features/wasel/landing/Differentiators";
import { TeamPreview } from "@/features/wasel/landing/TeamPreview";
import { GoalsVsTasks } from "@/features/wasel/landing/GoalsVsTasks";
import { MorningReport } from "@/features/wasel/landing/MorningReport";
import { PersonalErrands } from "@/features/wasel/landing/PersonalErrands";
import { ToolsIntegrations } from "@/features/wasel/landing/ToolsIntegrations";
import { Industries } from "@/features/wasel/landing/Industries";
import { Comparison } from "@/features/wasel/landing/Comparison";
import { Personas } from "@/features/wasel/landing/Personas";
import { Faq } from "@/features/wasel/landing/Faq";
import { Cta } from "@/features/wasel/landing/Cta";
import { Footer } from "@/features/wasel/layout/Footer";
import { Reveal } from "@/features/wasel/ui/Reveal";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Reveal><WallOfRequests /></Reveal>
      <Reveal><Pipeline /></Reveal>
      <Reveal><HowItWorks /></Reveal>
      <Reveal><Examples /></Reveal>
      <Reveal><Differentiators /></Reveal>
      <Reveal><TeamPreview /></Reveal>
      <Reveal><GoalsVsTasks /></Reveal>
      <Reveal><MorningReport /></Reveal>
      <Reveal><PersonalErrands /></Reveal>
      <Reveal><ToolsIntegrations /></Reveal>
      <Reveal><Industries /></Reveal>
      <Reveal><Comparison /></Reveal>
      <Reveal><Personas /></Reveal>
      <Reveal><Faq /></Reveal>
      <Reveal><Cta /></Reveal>
      <Footer />
    </>
  );
}
