"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, BookOpen, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";

type Milestone = "suite" | "tasks" | "prompt" | "strategy" | "runner_key" | "result";
type TutorialStatus = "active" | "dismissed" | "completed";
type SetupState = { status: TutorialStatus; progress: Record<Milestone, boolean> };

const STEPS: { id: Milestone; title: string; description: string; instructions: string[]; href: string; action: string }[] = [
  {
    id: "suite", title: "Create a suite and category",
    description: "A suite groups the capabilities you want to measure. Categories organize the tasks inside it.",
    instructions: ["Open Suites & tasks and choose Create Suite. Give it your own name and purpose.", "Select the suite, then Add category. For example, organize tasks by capability or language."],
    href: "/settings?section=tasks", action: "Open Suites & tasks",
  },
  {
    id: "tasks", title: "Add scored tasks",
    description: "Each task defines an input, a reference answer and the deterministic rule used to score the response.",
    instructions: ["In a category, choose Manage tasks, then Add task. You can also import JSON or CSV.", "Select a scorer and read its explanation and reference example. Supply the expected answer and any required configuration.", "Start with a few tasks whose correct and incorrect answers you can check yourself. No AI judge is used."],
    href: "/settings?section=tasks", action: "Add or import tasks",
  },
  {
    id: "prompt", title: "Write a base prompt",
    description: "The base prompt supplies system instructions shared by the tasks in a run.",
    instructions: ["Open Prompts and create a prompt with your own name and instructions.", "Tell the model the response format expected by your tasks. Keep instructions consistent with the selected scorers."],
    href: "/settings?section=prompts", action: "Open Prompts",
  },
  {
    id: "strategy", title: "Add a strategy",
    description: "A strategy adds an optional execution directive to your base prompt.",
    instructions: ["Open Strategies and create a strategy. Use a descriptive name and label.", "Add a directive when needed, or leave it empty for a plain execution. The platform offers only strategies you create."],
    href: "/settings?section=strategies", action: "Open Strategies",
  },
  {
    id: "runner_key", title: "Prepare runner access",
    description: "Inference runs on your machine or GPU host. The platform manages definitions and receives results.",
    instructions: ["In API access, create a separate admin key for the runner. Admin scope is needed to fetch task and prompt definitions; visitor keys can only view results.", "Copy the new key immediately and store it securely. Only its hash is saved. A second active admin key marks this step complete.", "On the dashboard, expand First time? under Run a benchmark. On the inference machine, use its clone command and bash scripts/setup.sh, then save API_KEY in the runner's private .env. Start your chosen inference service with a model already available there.", "Set Platform URL reachable from the runner to your platform's secured address. The model service belongs on the inference machine, not the platform server. Existing vLLM is the recommended mode; temporary startup is optional."],
    href: "/settings?section=api_keys", action: "Create runner access key",
  },
  {
    id: "result", title: "Run and inspect results",
    description: "Generate a command from your saved configuration, execute it with the runner, then inspect the measured result.",
    instructions: ["Return to the dashboard and choose an engine, model, suite, prompt and strategy. Copy the runner command and supply your runner API key on the execution machine.", "For the first run, use one repetition and concurrency 1. Give every run a unique, descriptive experiment tag.", "Run the command, then use Refresh on the dashboard. Inspect score reasons, execution errors and timing before comparing models.", "SLA policies are optional: configure your own thresholds in Settings when you are ready to qualify results."],
    href: "/#benchmark-runner", action: "Open benchmark runner",
  },
];

function readState(value: unknown): SetupState {
  const state = value as SetupState;
  if (!state || !["active", "dismissed", "completed"].includes(state.status) || !state.progress || STEPS.some((step) => typeof state.progress[step.id] !== "boolean")) {
    throw new Error("Invalid setup progress response");
  }
  return state;
}

export function SetupGuide({ refreshKey = 0, section }: { refreshKey?: string | number; section?: string }) {
  const [state, setState] = useState<SetupState | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const request = useCallback(async (status?: TutorialStatus) => {
    const id = ++requestId.current;
    setBusy(true);
    try {
      const response = await fetch("/api/onboarding", status ? {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      } : { cache: "no-store" });
      if (!response.ok) throw new Error(`Unable to load setup guide (HTTP ${response.status}). Check the backend connection and migrations.`);
      const result = readState(await response.json());
      if (id !== requestId.current) return;
      setState(result);
      setError(null);
      if (!status || status === "active") {
        const target = section ? `/settings?section=${section}` : null;
        const contextual = STEPS.findIndex((step) => step.href === target && !result.progress[step.id]);
        const next = contextual >= 0 ? contextual : target ? STEPS.findIndex((step) => step.href === target) : STEPS.findIndex((step) => !result.progress[step.id]);
        setSelected(next < 0 ? STEPS.length - 1 : next);
      }
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : "Unable to load setup guide");
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, [section]);

  useEffect(() => {
    void request();
    const refresh = () => { void request(); };
    window.addEventListener("setup-progress-changed", refresh);
    return () => { ++requestId.current; window.removeEventListener("setup-progress-changed", refresh); };
  }, [request, refreshKey]);

  if (!state) return <div className="setup-guide-status">
    {error ? <><p role="alert">{error}</p><button className="settings-btn-secondary" disabled={busy} onClick={() => void request()}>Retry setup guide</button></> : <p role="status">Loading setup guide…</p>}
  </div>;

  if (state.status !== "active") return <div className="setup-guide-status">
    <button className="settings-btn-secondary" disabled={busy} onClick={() => void request("active")}><BookOpen size={16} aria-hidden="true" /> Open setup guide</button>
    {error && <p role="alert">{error}</p>}
  </div>;

  const step = STEPS[selected];
  const completed = STEPS.filter((entry) => state.progress[entry.id]).length;
  return <section className="setup-guide" aria-labelledby="setup-guide-title" aria-busy={busy}>
    <div className="setup-guide-header">
      <div>
        <p className="text-eyebrow">Getting started</p>
        <h2 id="setup-guide-title">Set up your first benchmark</h2>
        <p>Your platform starts empty. Follow these steps with your own data, or skip the tutorial and reopen it later.</p>
      </div>
      <button className="settings-btn-secondary" disabled={busy} onClick={() => void request("dismissed")}><X size={16} aria-hidden="true" /> Skip tutorial</button>
    </div>
    <p className="setup-guide-progress" role="status">{completed} of {STEPS.length} setup milestones complete. Progress reflects saved records.</p>
    <div className="setup-guide-layout">
      <ol className="setup-guide-steps" aria-label="Setup steps">
        {STEPS.map((entry, index) => <li key={entry.id}>
          <button type="button" aria-current={index === selected ? "step" : undefined} onClick={() => setSelected(index)}>
            <span className="setup-guide-number" aria-hidden="true">{state.progress[entry.id] ? <Check size={15} /> : index + 1}</span>
            <span>{entry.title}{state.progress[entry.id] && <span className="sr-only"> — complete</span>}</span>
          </button>
        </li>)}
      </ol>
      <div className="setup-guide-detail" key={step.id}>
        <h3>{step.title}</h3>
        <p>{step.description}</p>
        <ol>{step.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
        <Link className="settings-btn-primary" href={step.href}>{step.action}<ChevronRight size={16} aria-hidden="true" /></Link>
      </div>
    </div>
    {error && <p className="setup-guide-error" role="alert">{error}</p>}
    <div className="setup-guide-footer">
      <button className="settings-btn-secondary" disabled={busy} onClick={() => void request()}><RefreshCw size={15} aria-hidden="true" /> Refresh progress</button>
      <div>
        <button className="settings-btn-secondary" disabled={selected === 0} onClick={() => setSelected((value) => value - 1)}><ChevronLeft size={16} aria-hidden="true" /> Back</button>
        {selected < STEPS.length - 1
          ? <button className="settings-btn-secondary" onClick={() => setSelected((value) => value + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button>
          : <button className="settings-btn-primary" disabled={busy} onClick={() => void request("completed")}>Finish tutorial</button>}
      </div>
    </div>
    <small className="setup-guide-note">Skipping or finishing hides this tutorial for the installation. You can reopen it here or in Settings. It never changes your benchmark configuration.</small>
  </section>;
}
