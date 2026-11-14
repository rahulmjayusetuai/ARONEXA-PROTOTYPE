import { DesignApp } from "@/design/DesignApp";
import manifest from "@/design/manifest.json";

export function generateStaticParams() {
  return [{ slug: undefined }, ...manifest.screens.filter((s) => (s as { module?: string }).module === "team").map((s) => ({ slug: [s.slug] }))];
}

export default async function TeamPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <DesignApp path={`/team/${slug?.[0] ?? ""}`} />;
}
