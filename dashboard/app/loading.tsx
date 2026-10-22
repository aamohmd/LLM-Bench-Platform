import { ScoreboardSkeleton } from "../components/SkeletonState";

export default function Loading() {
  return (
    <main className="visualizer" aria-busy="true" aria-live="polite">
      <ScoreboardSkeleton label="Loading benchmark console" />
    </main>
  );
}
