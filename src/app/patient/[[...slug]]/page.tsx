import { DesignApp } from "@/design/DesignApp";
import manifest from "@/design/manifest.json";

export function generateStaticParams() {
  return [{ slug: undefined }, ...manifest.screens.filter((s) => "module" in s).map((s) => ({ slug: [s.slug] }))];
}

export default async function PatientPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <DesignApp path={`/patient/${slug?.[0] ?? ""}`} />;
}
