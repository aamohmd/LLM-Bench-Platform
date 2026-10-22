import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="visualizer route-state-page">
      <section className="panel route-state-card">
        <SearchX size={28} aria-hidden="true" />
        <p className="text-eyebrow">Page not found</p>
        <h1 className="text-display">This route does not exist.</h1>
        <p className="text-sub">Return to the benchmark overview to continue exploring measured model results.</p>
        <Link href="/" className="settings-btn-primary"><ArrowLeft size={15} aria-hidden="true" /> Back to benchmarks</Link>
      </section>
    </main>
  );
}
