"use client";

export interface CandidateRecommendationProps {
  selectedConcurrency: number;
  verifiedCount: number;
  candidatesCount: number;
}

export function CandidateRecommendation({
  selectedConcurrency,
  verifiedCount,
  candidatesCount,
}: CandidateRecommendationProps) {
  if (selectedConcurrency !== 10 || candidatesCount === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 20px",
        background: "rgba(224, 255, 2, 0.04)",
        borderBottom: "1px solid rgba(224, 255, 2, 0.12)",
        fontSize: "0.78rem",
        color: "var(--text-secondary)",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: "var(--accent-lime)",
          boxShadow: "0 0 8px rgba(224, 255, 2, 0.6)",
          flexShrink: 0,
        }}
      />
      <span>
        <strong style={{ color: "var(--text-primary)" }}>Production Concurrency C=10:</strong>{" "}
        Showing {verifiedCount} verified C=10 {verifiedCount === 1 ? "deployment" : "deployments"} plus {candidatesCount} top candidate{candidatesCount === 1 ? "" : "s"} with complete passing category evidence and score ≥ 80 at another load.
      </span>
    </div>
  );
}
