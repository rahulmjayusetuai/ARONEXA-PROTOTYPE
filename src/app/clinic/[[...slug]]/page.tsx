import { DesignApp } from "@/design/DesignApp";
import manifest from "@/design/manifest.json";

export function generateStaticParams() {
  return [{ slug: undefined }, ...manifest.screens.filter((s) => (s as { module?: string }).module === "clinic").map((s) => ({ slug: [s.slug] }))];
}

export default async function ClinicPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <DesignApp path={`/clinic/${slug?.[0] ?? ""}`} />;
}
