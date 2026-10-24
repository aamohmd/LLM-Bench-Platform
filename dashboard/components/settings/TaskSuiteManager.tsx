"use client";

import { apiErrorMessage } from "../../lib/apiErrors";

import { useState, useEffect, useMemo, useRef, ChangeEvent, DragEvent } from "react";
import {
  parseTaskSuiteFile,
  TaskSuiteParseResult,
  TaskItem,
  BenchmarkSuite,
  parseScorerDefinitions,
  ScorerDefinition,
  parseExpectedAnswer,
  parseScoringConfig,
} from "../../lib/taskParser";
import {
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Search,
  Filter,
  RefreshCw,
  FileText,
  ChevronDown,
  ChevronUp,
  Terminal,
  Copy,
  Check,
  Play,
  ShieldAlert,
  Database,
  Sliders,
  ExternalLink,
  Plus,
  Pencil,
  X,
} from "lucide-react";
import { SettingsSectionSkeleton } from "../SkeletonState";
import { ConfirmDialog } from "../ConfirmDialog";
import { RegistryDeleteDialog } from "./RegistryDeleteDialog";
import { useDialogAccessibility } from "../useDialogAccessibility";
import { useRunnerRegistry, useSuiteExecution } from "../useRunnerConfiguration";
import { buildRunnerCommand } from "../../lib/runnerCommand";

type PendingDelete =
  | { type: "suite"; suite: BenchmarkSuite }
  | { type: "category"; suite: BenchmarkSuite; category: { id: string; name: string; task_count: number } }
  | { type: "task"; suite: BenchmarkSuite; task: TaskItem };

export function TaskSuiteManager({ onNotify }: { onNotify: (msg: string) => void }) {
  // Suites state
  const [suites, setSuites] = useState<BenchmarkSuite[]>([]);
  const [loadingSuites, setLoadingSuites] = useState(true);
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const [suitesError, setSuitesError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [availableScorers, setAvailableScorers] = useState<ReadonlySet<string>>(new Set());
  const [scorersError, setScorersError] = useState<string | null>(null);
  const [scorerDefinitions, setScorerDefinitions] = useState<ScorerDefinition[]>([]);

  // Inspect drawer / selected suite state
  const [inspectingSuite, setInspectingSuite] = useState<BenchmarkSuite | null>(null);
  const [inspectTasks, setInspectTasks] = useState<TaskItem[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskEditor, setTaskEditor] = useState<{ mode: "add" | "edit"; suite: BenchmarkSuite; task: TaskItem } | null>(null);
  const [savingTask, setSavingTask] = useState(false);
  const [scoringConfigText, setScoringConfigText] = useState("");
  const [scoringConfigTouched, setScoringConfigTouched] = useState(false);
  const selectedScorer = scorerDefinitions.find((entry) => entry.id === taskEditor?.task.task_type);
  const expectedAnswerError = useMemo(() => {
    if (!taskEditor) return null;
    try { parseExpectedAnswer(taskEditor.task.expected_answer, selectedScorer); return null; }
    catch (error) { return error instanceof Error ? error.message : "Invalid expected answer"; }
  }, [taskEditor, selectedScorer]);
  const scoringConfigError = useMemo(() => {
    try { parseScoringConfig(scoringConfigText); return null; }
    catch (error) { return error instanceof Error ? error.message : "Invalid JSON object"; }
  }, [scoringConfigText]);
  const openTaskEditor = (editor: NonNullable<typeof taskEditor>) => {
    setScoringConfigText(editor.task.scoring_config ? JSON.stringify(editor.task.scoring_config, null, 2) : "");
    setScoringConfigTouched(false);
    setTaskEditor(editor);
  };
  const [categoryEditor, setCategoryEditor] = useState<{
    mode: "add" | "edit";
    parent: BenchmarkSuite;
    category: { id: string; name: string; description: string; is_required: boolean; task_count: number };
  } | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [suiteEditor, setSuiteEditor] = useState({ id: "", name: "", domain: "general", description: "" });
  const [isSuiteEditorOpen, setIsSuiteEditorOpen] = useState(false);
  const [savingSuite, setSavingSuite] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const taskInspectorRef = useRef<HTMLDivElement>(null);

  // CLI command generator modal state
  const [cliSuite, setCliSuite] = useState<BenchmarkSuite | null>(null);
  const [cliEngine, setCliEngine] = useState<"vllm" | "ollama" | "openai-compatible">("vllm");
  const [cliModel, setCliModel] = useState<string>("");
  const [cliProviderEndpoint, setCliProviderEndpoint] = useState("");
  const [cliConcurrency, setCliConcurrency] = useState<number>(10);
  const [cliCopied, setCliCopied] = useState(false);
  const [cliCopyError, setCliCopyError] = useState<string | null>(null);
  const [cliPrompt, setCliPrompt] = useState("");
  const [cliStrategy, setCliStrategy] = useState("");
  const [cliTagSuffix] = useState(() => String(Date.now()));
  const runnerRegistry = useRunnerRegistry(Boolean(cliSuite));
  const suiteExecution = useSuiteExecution(cliSuite?.id || "", Boolean(cliSuite));
  useEffect(() => {
    if (runnerRegistry.prompts.length) setCliPrompt((previous) => runnerRegistry.prompts.some((row) => row.name === previous) ? previous : runnerRegistry.prompts[0].name);
    if (runnerRegistry.strategies.length) setCliStrategy((previous) => runnerRegistry.strategies.some((row) => row.name === previous) ? previous : runnerRegistry.strategies[0].name);
  }, [runnerRegistry.prompts, runnerRegistry.strategies]);

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parsedSuite, setParsedSuite] = useState<TaskSuiteParseResult | null>(null);
  const [customSuiteId, setCustomSuiteId] = useState("");
  const [customSuiteName, setCustomSuiteName] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [uploadParentSuiteId, setUploadParentSuiteId] = useState("");
  const [uploadRequired, setUploadRequired] = useState(true);
  const [rawFileText, setRawFileText] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);

  const closeUpload = () => {
    setIsUploadOpen(false);
    setParsedSuite(null);
    setRawFileText(null);
    setUploadFileName(null);
    setCustomSuiteId("");
  };

  const suiteDialogRef = useDialogAccessibility<HTMLDivElement>(isSuiteEditorOpen, () => setIsSuiteEditorOpen(false));
  const categoryDialogRef = useDialogAccessibility<HTMLDivElement>(Boolean(categoryEditor), () => setCategoryEditor(null));
  const cliDialogRef = useDialogAccessibility<HTMLDivElement>(Boolean(cliSuite), () => setCliSuite(null));
  const uploadDialogRef = useDialogAccessibility<HTMLDivElement>(isUploadOpen, closeUpload);
  const taskDialogRef = useDialogAccessibility<HTMLDivElement>(Boolean(taskEditor), () => setTaskEditor(null));

  const openUpload = (parentSuiteId?: string) => {
    const target = parentSuiteId || selectedSuiteId || "";
    setUploadParentSuiteId(target);
    const parent = suites.find((suite) => suite.id === target);
    if (parent) setCustomDomain(parent.domain);
    setUploadRequired(true);
    setIsUploadOpen(true);
  };

  const createEmptySuite = async () => {
    const suiteId = suiteEditor.id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    if (!suiteId || !suiteEditor.name.trim()) {
      setOperationError("Suite ID and name are required.");
      return;
    }
    setSavingSuite(true);
    try {
      const res = await fetch("/api/suites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: suiteId,
          parent_suite_id: suiteId,
          name: suiteEditor.name.trim(),
          domain: suiteEditor.domain.trim() || "general",
          description: suiteEditor.description.trim() || null,
          is_required: false,
          is_active: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, "Suite could not be created"));
      onNotify(`Empty suite created: ${suiteEditor.name.trim()}`);
      setSelectedSuiteId(suiteId);
      setIsSuiteEditorOpen(false);
      setSuiteEditor({ id: "", name: "", domain: "general", description: "" });
      await loadSuites();
    } catch (err: any) {
      setOperationError(`Suite creation failed: ${err.message}`);
    } finally {
      setSavingSuite(false);
    }
  };

  // Load Suites
  const loadSuites = async () => {
    setLoadingSuites(true);
    try {
      const res = await fetch("/api/suites");
      if (!res.ok) throw new Error(`Unable to load benchmark suites (HTTP ${res.status})`);
      const data = await res.json();
      setSuites(Array.isArray(data) ? data : []);
      setSuitesError(null);
    } catch (err) {
      setSuitesError(err instanceof Error ? err.message : "Unable to load benchmark suites");
    } finally {
      setLoadingSuites(false);
    }
  };

  useEffect(() => {
    void loadSuites();
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/scorers/catalog");
        if (!response.ok) throw new Error(`Unable to load scorers (HTTP ${response.status})${response.status === 404 ? ". Deploy the backend scorer catalog endpoint." : ""}`);
        const definitions = parseScorerDefinitions(await response.json());
        if (active) { setScorerDefinitions(definitions); setAvailableScorers(new Set(definitions.map((entry) => entry.id))); setScorersError(null); }
      } catch (error) {
        if (active) setScorersError(error instanceof Error ? error.message : "Unable to load scorers");
      }
    })();
    return () => { active = false; };
  }, []);

  // Load tasks for inspected suite
  const loadSuiteTasks = async (suite: BenchmarkSuite) => {
    setInspectingSuite(suite);
    setLoadingTasks(true);
    setTasksError(null);
    setInspectTasks([]);
    try {
      const res = await fetch(`/api/suites/${encodeURIComponent(suite.id)}/tasks`);
      if (!res.ok) throw new Error(`Unable to load suite tasks (HTTP ${res.status})`);
      const data = await res.json();
      setInspectTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      setTasksError(err instanceof Error ? err.message : "Unable to load suite tasks");
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    if (inspectingSuite) taskInspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [inspectingSuite?.id]);

  const toggleCategoryRequired = async (parent: BenchmarkSuite, group: { id: string; name: string; task_count: number; is_required?: boolean }) => {
    try {
      const res = await fetch(`/api/suites/${encodeURIComponent(group.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: group.id, name: group.name, domain: parent.domain, is_required: group.is_required === false }),
      });
      if (!res.ok) throw new Error(apiErrorMessage(await res.json(), "Category requirement could not be updated"));
      onNotify(`${group.name} is now ${group.is_required === false ? "required" : "optional"} for future scoreboard runs.`);
      await loadSuites();
    } catch (err: any) {
      setOperationError(`Category update failed: ${err.message}`);
    }
  };

  const openCategoryEditor = async (parent: BenchmarkSuite, group?: { id: string; name: string; task_count: number; is_required?: boolean }) => {
    if (!group) {
      setCategoryEditor({
        mode: "add",
        parent,
        category: { id: "", name: "", description: "", is_required: false, task_count: 0 },
      });
      return;
    }
    let detail: Partial<BenchmarkSuite> = group;
    try {
      const res = await fetch(`/api/suites/${encodeURIComponent(group.id)}`);
      if (res.ok) detail = await res.json();
    } catch (err) {
      console.error("Failed to load category details:", err);
    }
    setCategoryEditor({
      mode: "edit",
      parent,
      category: {
        id: group.id,
        name: detail.name || group.name,
        description: detail.description || "",
        is_required: group.task_count > 0 && group.is_required !== false,
        task_count: group.task_count,
      },
    });
  };

  const saveCategory = async () => {
    if (!categoryEditor) return;
    const { mode, parent, category } = categoryEditor;
    const categoryId = category.id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    if (!categoryId || !category.name.trim()) {
      setOperationError("Category ID and name are required.");
      return;
    }
    setSavingCategory(true);
    try {
      const res = await fetch(`/api/suites${mode === "edit" ? `/${encodeURIComponent(categoryId)}` : ""}`, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: categoryId,
          parent_suite_id: parent.id,
          name: category.name.trim(),
          domain: parent.domain,
          description: category.description.trim() || null,
          is_required: category.task_count > 0 && category.is_required,
          is_active: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, "Category could not be saved"));
      onNotify(`Category ${mode === "edit" ? "updated" : "added"}: ${category.name.trim()}`);
      setCategoryEditor(null);
      await loadSuites();
    } catch (err: any) {
      setOperationError(`Category save failed: ${err.message}`);
    } finally {
      setSavingCategory(false);
    }
  };

  const saveTask = async () => {
    if (!taskEditor) return;
    setScoringConfigTouched(true);
    if (scoringConfigError || expectedAnswerError || !availableScorers.has(taskEditor.task.task_type)) return;
    setSavingTask(true);
    try {
      const { task, suite, mode } = taskEditor;
      const payload = { ...task, expected_answer: parseExpectedAnswer(task.expected_answer, selectedScorer), scoring_config: parseScoringConfig(scoringConfigText), suite_id: task.suite_id || suite.id, suite_name: task.suite_name || suite.name, domain: task.domain || suite.domain };
      const res = await fetch(`/api/tasks${mode === "edit" ? `/${encodeURIComponent(task.id)}` : ""}`, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, "Task could not be saved"));
      onNotify(`Task ${mode === "edit" ? "updated" : "added"}: ${task.id}`);
      setTaskEditor(null);
      await loadSuites();
      await loadSuiteTasks(suite);
    } catch (err: any) {
      setOperationError(`Task save failed: ${err.message}`);
    } finally {
      setSavingTask(false);
    }
  };

  const deleteTask = async (suite: BenchmarkSuite, task: TaskItem) => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(apiErrorMessage(await res.json(), "Task could not be removed"));
      onNotify(`Task removed: ${task.id}`);
      setPendingDelete(null);
      await loadSuites();
      await loadSuiteTasks(suite);
    } catch (err: any) {
      setOperationError(`Task removal failed: ${err.message}`);
    }
  };

  // File parsing for upload
  const processFile = (file: File) => {
    if (availableScorers.size === 0) {
      setOperationError(scorersError || "Wait for the API scorer catalog before importing tasks.");
      return;
    }
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setRawFileText(text);
      const parsed = parseTaskSuiteFile(text, file.name, availableScorers);
      setParsedSuite(parsed);
      setCustomSuiteId(parsed.suite_id || "");
      setCustomSuiteName(parsed.suite_name || parsed.category_metadata.display_name || "");
      setCustomDomain(suites.find((suite) => suite.id === uploadParentSuiteId)?.domain || "general");
      if (parsed.category_metadata.is_required != null) setUploadRequired(parsed.category_metadata.is_required);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const submitSuiteUpload = async () => {
    if (!parsedSuite || !rawFileText) return;
    setUploading(true);
    try {
      let payloadObj: any;
      try {
        payloadObj = JSON.parse(rawFileText);
      } catch {
        payloadObj = {
          suite_id: parsedSuite.suite_id,
          suite_name: customSuiteName.trim() || parsedSuite.suite_name,
          domain: customDomain.trim() || parsedSuite.domain,
          tasks: parsedSuite.tasks,
        };
      }

      if (typeof payloadObj === "object" && !Array.isArray(payloadObj)) {
        const normalizedSuiteId = customSuiteId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
        if (!normalizedSuiteId) throw new Error("Suite/category ID is required");
        if (!uploadParentSuiteId) throw new Error("Select the parent suite for this category");
        const parentSuiteId = uploadParentSuiteId;
        payloadObj.suite_id = normalizedSuiteId;
        payloadObj.parent_suite_id = parentSuiteId;
        payloadObj.is_required = uploadRequired;
        payloadObj.category_metadata = {
          ...(payloadObj.category_metadata && typeof payloadObj.category_metadata === "object" ? payloadObj.category_metadata : {}),
          category_id: normalizedSuiteId,
          suite_id: normalizedSuiteId,
          parent_suite_id: parentSuiteId,
          is_required: uploadRequired,
        };
        if (customSuiteName.trim()) {
          payloadObj.suite_name = customSuiteName.trim();
          payloadObj.name = customSuiteName.trim();
          payloadObj.category_metadata.suite_name = customSuiteName.trim();
          payloadObj.category_metadata.display_name = customSuiteName.trim();
        }
        if (customDomain.trim()) {
          payloadObj.domain = customDomain.trim();
          payloadObj.category_metadata.domain = customDomain.trim();
        }
      }

      const res = await fetch("/api/suites/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadObj),
      });

      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(apiErrorMessage(data, "Upload rejected"));
      }

      onNotify(`✓ Suite "${data.suite_name || customSuiteName}" saved with ${data.total_tasks || data.inserted} tasks!`);
      closeUpload();
      await loadSuites();
    } catch (err: any) {
      setOperationError(`Import failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Filtered suites
  const domains = useMemo(() => {
    const s = new Set<string>();
    suites.forEach((item) => {
      if (item.domain) s.add(item.domain);
    });
    return Array.from(s);
  }, [suites]);

  const filteredSuites = useMemo(() => {
    return suites.filter((s) => {
      if (domainFilter !== "all" && s.domain !== domainFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [suites, domainFilter, searchQuery]);

  const selectedSuite = filteredSuites.find((suite) => suite.id === selectedSuiteId) || filteredSuites[0];

  const totalTasksAllSuites = useMemo(() => {
    return suites.reduce((acc, curr) => acc + (curr.task_count || 0), 0);
  }, [suites]);

  // Filtered inspection tasks
  const filteredInspectTasks = useMemo(() => {
    if (!taskSearch.trim()) return inspectTasks;
    const q = taskSearch.toLowerCase();
    return inspectTasks.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.prompt.toLowerCase().includes(q) ||
        (t.task_type && t.task_type.toLowerCase().includes(q)) ||
        (t.bucket && t.bucket.toLowerCase().includes(q))
    );
  }, [inspectTasks, taskSearch]);

  // CLI command string
  const generatedCliCmd = useMemo(() => {
    if (!cliSuite || runnerRegistry.error || !suiteExecution.runnable) return "";
    const backendUrl =
      process.env.NEXT_PUBLIC_BENCHMARK_API_URL ||
      (typeof window !== "undefined" ? window.location.origin : "") ||
      "<BACKEND_URL>";
    return buildRunnerCommand({ model: cliModel, engine: cliEngine, suite: cliSuite.id,
      prompt: cliPrompt, strategy: cliStrategy, backendUrl, concurrency: cliConcurrency,
      settings: cliEngine === "openai-compatible" ? { maxOutputTokens: 512, temperature: 0, seed: 42, responseFormat: "text", endpoint: cliProviderEndpoint.trim() || undefined } : undefined,
      experimentTag: `settings-${cliEngine}-${cliSuite.id}-${cliTagSuffix}` });
  }, [cliSuite, cliEngine, cliModel, cliConcurrency, cliPrompt, cliStrategy, cliTagSuffix, cliProviderEndpoint, runnerRegistry.error, suiteExecution.runnable]);

  const copyCliCommand = async () => {
    if (!generatedCliCmd) return;
    try {
      await navigator.clipboard.writeText(generatedCliCmd);
      setCliCopyError(null);
      setCliCopied(true);
      setTimeout(() => setCliCopied(false), 2000);
      onNotify("CLI command copied to clipboard.");
    } catch {
      setCliCopyError("Clipboard access was blocked. Select the command and copy it manually.");
    }
  };

  return (
    <section className="settings-section-card suite-manager">
      <div className="settings-section-card-header suite-manager__header">
        <div>
          <h2>Suites</h2>
          <p>
            A Suite groups categories. Each category holds tasks and can be required for a benchmark result.
          </p>
          <p className="suite-manager__totals">{suites.length} suite{suites.length === 1 ? "" : "s"} · {totalTasksAllSuites} tasks</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={() => void loadSuites()}
            disabled={loadingSuites}
            className="settings-btn-secondary"
          >
            <RefreshCw size={15} className={loadingSuites ? "animate-spin" : ""} />
            Refresh
          </button>

          <button
            onClick={() => { setSuiteEditor({ id: "", name: "", domain: "general", description: "" }); setIsSuiteEditorOpen(true); }}
            className="settings-btn-primary"
          >
            <Plus size={16} /> Create Suite
          </button>
        </div>
      </div>

      {scorersError && <div className="settings-state-card" role="alert"><AlertTriangle size={20} aria-hidden="true" /><p>{scorersError} Task creation and imports require the scorer catalog.</p></div>}
      {operationError && (
        <div className="settings-error-banner" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div style={{ flex: 1 }}><strong>Action error:</strong> {operationError}</div>
          <button type="button" className="settings-icon-button" onClick={() => setOperationError(null)} aria-label="Dismiss error"><X size={16} aria-hidden="true" /></button>
        </div>
      )}

      {/* Filter and Search Toolbar */}
      <div className="settings-action-bar suite-manager__toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
            <Filter size={14} /> Domain:
          </span>
          <button
            onClick={() => setDomainFilter("all")}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
              background: domainFilter === "all" ? "var(--text-primary)" : "rgba(255, 255, 255, 0.05)",
              color: domainFilter === "all" ? "#000" : "var(--text-muted)",
              border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
            }}
          >
            All ({suites.length})
          </button>
          {domains.map((dom) => (
            <button
              key={dom}
              onClick={() => setDomainFilter(dom)}
              style={{
                padding: "5px 12px",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: 600,
                textTransform: "capitalize",
                cursor: "pointer",
                background: domainFilter === dom ? "var(--text-primary)" : "rgba(255, 255, 255, 0.05)",
                color: domainFilter === dom ? "#000" : "var(--text-muted)",
                border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
              }}
            >
              {dom} ({suites.filter((s) => s.domain === dom).length})
            </button>
          ))}
        </div>

        <div className="settings-search-box">
          <Search size={15} style={{ position: "absolute", left: "12px", top: "11px", color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Search suites by name or id..."
            aria-label="Search suites"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Select a Suite, then manage its categories and tasks. */}
      {loadingSuites ? (
        <SettingsSectionSkeleton label="Loading benchmark suite inventory" rows={5} />
      ) : suitesError ? (
        <div className="settings-state-card" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <div><h3>Benchmark suites could not be loaded</h3><p>{suitesError}</p></div>
          <button type="button" className="settings-btn-secondary" onClick={() => void loadSuites()}>Retry</button>
        </div>
      ) : filteredSuites.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            background: "rgba(255, 255, 255, 0.02)",
            borderRadius: "12px",
            border: "1px dashed var(--border-color, rgba(255, 255, 255, 0.15))",
          }}
        >
          <Database size={32} style={{ color: "var(--text-muted)", margin: "0 auto 12px" }} />
          <h3 style={{ margin: "0 0 6px 0", color: "var(--text-primary)", fontSize: "1.1rem" }}>No benchmark suites found</h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "0.88rem", color: "var(--text-muted)" }}>
            Create a Suite first, then add categories manually or import them.
          </p>
          <button
            onClick={() => { setSuiteEditor({ id: "", name: "", domain: "general", description: "" }); setIsSuiteEditorOpen(true); }}
            className="settings-btn-primary"
          >
            Create Suite
          </button>
        </div>
      ) : (
        <div className="suite-manager__workspace">
          <nav className="suite-manager__suite-list" aria-label="Suites">
            <h3>Select a Suite</h3>
            {filteredSuites.map((suite) => <button key={suite.id} type="button" className={`suite-manager__suite-option${selectedSuite?.id === suite.id ? " is-active" : ""}`} aria-current={selectedSuite?.id === suite.id ? "true" : undefined} onClick={() => { setSelectedSuiteId(suite.id); setInspectingSuite(null); }}>
              <strong>{suite.name}</strong><span>{suite.task_groups?.length ?? 0} categories · {suite.task_count ?? 0} tasks</span>
            </button>)}
          </nav>
          <div className="suite-manager__detail">
          {[selectedSuite].map((s) => (
            <div
              key={s.id}
              className="settings-inventory-card suite-manager__suite-card"
            >
              <div>
                <div className="suite-manager__suite-meta"><span>{s.domain || "general"}</span><span>{s.task_groups?.length ?? 0} categories</span><span>{s.task_count ?? 0} tasks</span></div>
                <h3 className="suite-manager__suite-name">{s.name}</h3>
                <p className="suite-manager__suite-id">ID: {s.id}</p>
                <p className="suite-manager__suite-description">{s.description || "Describe what this Suite is meant to evaluate."}</p>
                <div className="suite-manager__category-tools">
                  <div><h4>Categories</h4><p>Choose how to add a category, then manage its tasks below.</p></div>
                  <div className="suite-manager__category-actions">
                    <button type="button" onClick={() => void openCategoryEditor(s)} className="settings-btn-secondary"><Plus size={15} aria-hidden="true" /> Add category</button>
                    <button type="button" onClick={() => openUpload(s.id)} className="settings-btn-secondary"><UploadCloud size={15} aria-hidden="true" /> Import category</button>
                    <button type="button" className="settings-btn-secondary suite-manager__document-pending" disabled>Generate from documents</button>
                  </div>
                </div>
                {(s.task_groups?.length ?? 0) > 0 ? (
                  <div className="suite-manager__category-list">
                    {s.task_groups!.map((group) => (
                      <div key={group.id} className="suite-manager__category-row">
                        <button
                          onClick={() => void loadSuiteTasks({ ...s, id: group.id, name: group.name, task_count: group.task_count, task_groups: undefined })}
                          className="suite-manager__category-open"
                          aria-label={`Manage tasks in ${group.name}`}
                        >
                          <strong>{group.name}</strong><span>{group.task_count} task{group.task_count === 1 ? "" : "s"}</span>
                        </button>
                        <div className="suite-manager__category-controls">
                          <label title={group.task_count > 0 ? "Require this category for scoreboard qualification" : "Add tasks before requiring this category"}>
                            <input type="checkbox" checked={group.task_count > 0 && group.is_required !== false} disabled={group.task_count === 0} onChange={() => void toggleCategoryRequired(s, group)} /> Required
                          </label>
                          <button type="button" onClick={() => void openCategoryEditor(s, group)} aria-label={`Edit ${group.name} category`} title="Edit category" className="settings-icon-button"><Pencil size={16} aria-hidden="true" /></button>
                          <button type="button" onClick={() => setPendingDelete({ type: "category", suite: s, category: group })} className="settings-icon-button is-danger" aria-label={`Remove ${group.name} category`} title="Remove category"><Trash2 size={16} aria-hidden="true" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="suite-manager__category-empty">This Suite has no categories yet. Add one above to start building its benchmark.</p>
                )}
              </div>

              {/* Scorer & Action Buttons */}
              <div
                style={{
                  borderTop: "1px solid var(--border-color, rgba(255, 255, 255, 0.08))",
                  paddingTop: "14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <div style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
                  Scorer:{" "}
                  <code style={{ color: "var(--text-primary)", background: "rgba(255, 255, 255, 0.05)", padding: "2px 4px", borderRadius: "3px" }}>
                    {s.default_scorer || (s.task_groups?.length ? "suite_composite" : "configured_per_task")}
                  </code>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => void loadSuiteTasks(s)}
                    title="View all tasks in this Suite"
                    style={{
                      padding: "6px 10px",
                      borderRadius: "6px",
                      background: "rgba(255, 255, 255, 0.06)",
                      border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
                      color: "var(--text-primary)",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <Sliders size={13} />
                    View all tasks
                  </button>

              <button
                onClick={() => setCliSuite(s)}
                    title="View remote runner CLI command"
                    style={{
                      padding: "6px 10px",
                      borderRadius: "6px",
                      background: "rgba(224, 255, 2, 0.12)",
                      border: "1px solid rgba(224, 255, 2, 0.3)",
                      color: "#e0ff02",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <Terminal size={13} />
                    CLI
                  </button>

                  <button
                    onClick={() => setPendingDelete({ type: "suite", suite: s })}
                    title="Delete suite"
                    style={{
                      padding: "6px 8px",
                      borderRadius: "6px",
                      background: "rgba(244, 63, 94, 0.1)",
                      border: "1px solid rgba(244, 63, 94, 0.2)",
                      color: "#f43f5e",
                      fontSize: "0.78rem",
                      cursor: "pointer",
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {/* Tasks remain in the selected Suite workspace. */}
          {inspectingSuite && (
        <div ref={taskInspectorRef} className="suite-manager__task-panel">
          <div className="suite-manager__task-header">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FileText size={20} style={{ color: "#38bdf8" }} />
                <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  {inspectingSuite.name} — Tasks
                </h3>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "0.84rem", color: "var(--text-muted)" }}>
                Showing {filteredInspectTasks.length} of {inspectTasks.length} tasks
              </p>
              <p className="suite-manager__task-help">{inspectingSuite.parent_suite_id === inspectingSuite.id ? "Browse tasks across this Suite. Open a category above to add tasks." : "Review and manage the tasks in this category."}</p>
            </div>

            <div className="suite-manager__task-toolbar">
              <input
                type="text"
                aria-label="Search tasks"
                placeholder="Find a task by prompt, ID, or type..."
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
              />
              <button type="button" onClick={() => setInspectingSuite(null)} className="settings-btn-secondary">
                Close tasks
              </button>

              {inspectingSuite.parent_suite_id !== inspectingSuite.id && (
                <button type="button" className="settings-btn-primary"
                  disabled={availableScorers.size === 0}
                  onClick={() => openTaskEditor({ mode: "add", suite: inspectingSuite, task: { id: `${inspectingSuite.id}-new`, suite_id: inspectingSuite.id, suite_name: inspectingSuite.name, domain: inspectingSuite.domain, category_id: inspectingSuite.id, prompt: "", expected_answer: "", task_type: [...availableScorers][0], bucket: "general", language: "en" } })}
                  title="Add task to category"
                ><Plus size={13} /> Add task</button>
              )}
            </div>
          </div>

          {loadingTasks ? (
            <SettingsSectionSkeleton label="Loading suite tasks" rows={4} compact />
          ) : tasksError ? (
            <div className="settings-state-card" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <div><h3>Suite tasks could not be loaded</h3><p>{tasksError}</p></div>
              <button type="button" className="settings-btn-secondary" onClick={() => void loadSuiteTasks(inspectingSuite)}>Retry</button>
            </div>
          ) : filteredInspectTasks.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              No tasks matched your filter query.
            </div>
          ) : (
            <div className="suite-manager__task-list">
              {filteredInspectTasks.map((t, idx) => {
                const isExpanded = expandedTaskId === t.id;
                return (
                  <div key={t.id} className="suite-manager__task-item">
                    <div className="suite-manager__task-row">
                      <button type="button" className="suite-manager__task-open" aria-expanded={isExpanded} onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}>
                        <span className="suite-manager__task-index">{idx + 1}</span>
                        <span className="suite-manager__task-summary">
                          <strong>{t.prompt}</strong>
                          <small><span>{t.task_type}</span><span title={t.id}>ID: {t.id}</span></small>
                        </span>
                        {isExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                      </button>
                      <div className="suite-manager__task-actions">
                        <button type="button" onClick={() => openTaskEditor({ mode: "edit", suite: inspectingSuite, task: t })} aria-label={`Edit task ${t.id}`} className="settings-icon-button"><Pencil size={15} aria-hidden="true" /></button>
                        <button type="button" onClick={() => setPendingDelete({ type: "task", suite: inspectingSuite, task: t })} aria-label={`Remove task ${t.id}`} className="settings-icon-button is-danger"><Trash2 size={15} aria-hidden="true" /></button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="suite-manager__task-detail"
                        style={{
                          marginTop: "12px",
                          paddingTop: "12px",
                          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                          fontSize: "0.84rem",
                        }}
                      >
                        <div>
                          <strong style={{ color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Prompt:</strong>
                          <pre
                            style={{
                              margin: 0,
                              padding: "10px",
                              background: "rgba(0, 0, 0, 0.3)",
                              borderRadius: "6px",
                              whiteSpace: "pre-wrap",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: "0.82rem",
                              color: "var(--text-primary)",
                            }}
                          >
                            {t.prompt}
                          </pre>
                        </div>

                        <div className="settings-form-grid">
                          <div>
                            <strong style={{ color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Expected Answer:</strong>
                            <span style={{ color: "var(--accent-lime)", fontWeight: 600 }}>{String(t.expected_answer)}</span>
                          </div>
                          {t.tolerance && (
                            <div>
                              <strong style={{ color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Tolerance:</strong>
                              <span>rel: {t.tolerance.relative}, floor: {t.tolerance.absolute_floor}</span>
                            </div>
                          )}
                        </div>

                        {t.scoring_config && (
                          <div>
                            <strong style={{ color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Scoring Config / Extra Attributes:</strong>
                            <pre
                              style={{
                                margin: 0,
                                padding: "8px",
                                background: "rgba(0, 0, 0, 0.3)",
                                borderRadius: "6px",
                                fontSize: "0.78rem",
                                color: "#38bdf8",
                              }}
                            >
                              {JSON.stringify(t.scoring_config, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
          )}
          </div>
        </div>
      )}

      {/* Empty parent suite editor */}
      {isSuiteEditorOpen && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsSuiteEditorOpen(false)}>
          <div ref={suiteDialogRef} className="settings-modal-card suite-manager__modal" role="dialog" aria-modal="true" aria-labelledby="suite-editor-title" tabIndex={-1}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><h3 id="suite-editor-title" style={{ margin: 0, color: "var(--text-primary)", fontSize: "1.15rem" }}>Create Suite</h3><p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>Group categories here, then add tasks to each category.</p></div>
              <button onClick={() => setIsSuiteEditorOpen(false)} aria-label="Close suite editor" className="settings-icon-button"><X size={17} aria-hidden="true" /></button>
            </div>
            <div className="settings-form-grid">
              <label style={{ display: "flex", flexDirection: "column", gap: "5px", color: "var(--text-muted)", fontSize: "0.76rem" }}>Suite ID<input value={suiteEditor.id} onChange={(e) => setSuiteEditor({ ...suiteEditor, id: e.target.value })} placeholder="customer_support" style={{ padding: "9px 10px", borderRadius: "6px", border: "1px solid var(--border-color, rgba(255,255,255,0.15))", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)" }} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: "5px", color: "var(--text-muted)", fontSize: "0.76rem" }}>Display name<input value={suiteEditor.name} onChange={(e) => setSuiteEditor({ ...suiteEditor, name: e.target.value })} placeholder="Customer support" style={{ padding: "9px 10px", borderRadius: "6px", border: "1px solid var(--border-color, rgba(255,255,255,0.15))", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)" }} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: "5px", color: "var(--text-muted)", fontSize: "0.76rem" }}>Domain<input value={suiteEditor.domain} onChange={(e) => setSuiteEditor({ ...suiteEditor, domain: e.target.value })} style={{ padding: "9px 10px", borderRadius: "6px", border: "1px solid var(--border-color, rgba(255,255,255,0.15))", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)" }} /></label>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "5px", color: "var(--text-muted)", fontSize: "0.76rem" }}>Description<textarea value={suiteEditor.description} onChange={(e) => setSuiteEditor({ ...suiteEditor, description: e.target.value })} rows={3} style={{ padding: "9px 10px", borderRadius: "6px", border: "1px solid var(--border-color, rgba(255,255,255,0.15))", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)", resize: "vertical" }} /></label>
            <div className="settings-modal-actions"><button onClick={() => setIsSuiteEditorOpen(false)} className="settings-btn-secondary">Cancel</button><button onClick={() => void createEmptySuite()} disabled={savingSuite} className="settings-btn-primary">{savingSuite ? "Creating…" : "Create empty suite"}</button></div>
          </div>
        </div>
      )}

      {/* Category editor */}
      {categoryEditor && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCategoryEditor(null)}>
          <div ref={categoryDialogRef} className="settings-modal-card suite-manager__modal" role="dialog" aria-modal="true" aria-labelledby="category-editor-title" tabIndex={-1}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <div>
                <h3 id="category-editor-title" style={{ margin: 0, color: "var(--text-primary)", fontSize: "1.15rem" }}>{categoryEditor.mode === "add" ? "Add category" : "Edit category"}</h3>
                <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>Suite: {categoryEditor.parent.name}</p>
              </div>
              <button onClick={() => setCategoryEditor(null)} aria-label="Close category editor" className="settings-icon-button"><X size={17} aria-hidden="true" /></button>
            </div>

            <div className="settings-form-grid">
              <label style={{ display: "flex", flexDirection: "column", gap: "5px", color: "var(--text-muted)", fontSize: "0.76rem" }}>
                Category ID
                <input value={categoryEditor.category.id} disabled={categoryEditor.mode === "edit"} onChange={(e) => setCategoryEditor({ ...categoryEditor, category: { ...categoryEditor.category, id: e.target.value } })} placeholder="policy_qa" style={{ padding: "9px 10px", borderRadius: "6px", border: "1px solid var(--border-color, rgba(255,255,255,0.15))", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "5px", color: "var(--text-muted)", fontSize: "0.76rem" }}>
                Display name
                <input value={categoryEditor.category.name} onChange={(e) => setCategoryEditor({ ...categoryEditor, category: { ...categoryEditor.category, name: e.target.value } })} placeholder="Policy questions" style={{ padding: "9px 10px", borderRadius: "6px", border: "1px solid var(--border-color, rgba(255,255,255,0.15))", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)" }} />
              </label>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: "5px", color: "var(--text-muted)", fontSize: "0.76rem" }}>
              Description
              <textarea value={categoryEditor.category.description} onChange={(e) => setCategoryEditor({ ...categoryEditor, category: { ...categoryEditor.category, description: e.target.value } })} rows={3} style={{ padding: "9px 10px", borderRadius: "6px", border: "1px solid var(--border-color, rgba(255,255,255,0.15))", background: "rgba(255,255,255,0.04)", color: "var(--text-primary)", resize: "vertical" }} />
            </label>
            <div className="settings-form-grid" style={{ alignItems: "end" }}>
              <label title={categoryEditor.category.task_count > 0 ? "Require this category on the scoreboard" : "Add tasks before requiring this category"} style={{ display: "inline-flex", alignItems: "center", gap: "7px", minHeight: "36px", color: categoryEditor.category.task_count > 0 ? "var(--text-primary)" : "var(--text-muted)", fontSize: "0.82rem" }}>
                <input type="checkbox" checked={categoryEditor.category.task_count > 0 && categoryEditor.category.is_required} disabled={categoryEditor.category.task_count === 0} onChange={(e) => setCategoryEditor({ ...categoryEditor, category: { ...categoryEditor.category, is_required: e.target.checked } })} /> Required for qualification
              </label>
            </div>
            {categoryEditor.category.task_count === 0 && <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.76rem" }}>Empty categories stay optional. Add tasks, then mark the category required.</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button onClick={() => setCategoryEditor(null)} className="settings-btn-secondary">Cancel</button>
              <button onClick={() => void saveCategory()} disabled={savingCategory} className="settings-btn-primary">{savingCategory ? "Saving…" : "Save category"}</button>
            </div>
          </div>
        </div>
      )}

      {/* CLI Command Helper Modal */}
      {cliSuite && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCliSuite(null)}>
          <div
            ref={cliDialogRef}
            className="settings-modal-card suite-manager__modal suite-manager__modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="suite-cli-title"
            tabIndex={-1}
            style={{
              maxWidth: "680px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Terminal size={20} style={{ color: "var(--accent-lime)" }} aria-hidden="true" />
                <h3 id="suite-cli-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  Run Benchmark via Remote CLI
                </h3>
              </div>
              <button
                onClick={() => setCliSuite(null)}
                className="settings-icon-button"
                aria-label="Close command helper"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
              Execute this command on your GPU execution node (e.g. Mac Metal or NVIDIA AWS box). It will fetch the{" "}
              <strong style={{ color: "var(--accent-lime)" }}>{cliSuite.name}</strong> tasks dynamically from the backend control plane and submit telemetry back automatically.
            </p>

            {/* Quick config parameters */}
            {runnerRegistry.error && <p role="alert">{runnerRegistry.error}</p>}
            {!suiteExecution.runnable && <p role="status">{suiteExecution.reason}</p>}
            <div className="suite-manager__cli-grid">
              <div>
                <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Engine</label>
                <select
                  value={cliEngine}
                  onChange={(e) => setCliEngine(e.target.value as any)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border-color, rgba(255, 255, 255, 0.15))",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                  }}
                >
                  <option value="vllm">vLLM</option>
                  <option value="ollama">Ollama</option>
                  <option value="openai-compatible">Hosted API (OpenAI-compatible)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Target Model</label>
                <input
                  type="text"
                  value={cliModel}
                  onChange={(e) => setCliModel(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border-color, rgba(255, 255, 255, 0.15))",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Concurrency</label>
                <input
                  type="number"
                  min={1}
                  value={cliConcurrency}
                  onChange={(e) => setCliConcurrency(parseInt(e.target.value) || 1)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border-color, rgba(255, 255, 255, 0.15))",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>
            </div>

            <div className="suite-manager__cli-grid">
              <label>Registered prompt<select className="recipe-select" value={cliPrompt} onChange={(event) => setCliPrompt(event.target.value)}>{runnerRegistry.prompts.map((prompt) => <option key={prompt.id} value={prompt.name}>{prompt.name}</option>)}</select></label>
              <label>Registered strategy<select className="recipe-select" value={cliStrategy} onChange={(event) => setCliStrategy(event.target.value)}>{runnerRegistry.strategies.map((strategy) => <option key={strategy.id} value={strategy.name}>{strategy.name}</option>)}</select></label>
            </div>

            {cliEngine === "openai-compatible" && <div className="settings-form-field">
              <label htmlFor="suite-provider-endpoint" className="settings-field-label">Provider API base URL</label>
              <input id="suite-provider-endpoint" className="recipe-input" type="url" value={cliProviderEndpoint}
                placeholder="https://<provider-host>/v1" onChange={(event) => setCliProviderEndpoint(event.target.value)} />
              <p className="settings-field-hint">Leave empty to use the runner's OPENAI_BASE_URL or the OpenAI API default. Set OPENAI_API_KEY in the runner's .env for provider access, separately from the platform API_KEY. Requests may incur charges; respect provider rate limits. GPU and memory measurements are unavailable.</p>
            </div>}

            {/* Code Box */}
            <div style={{ position: "relative" }}>
              <pre
                style={{
                  margin: 0,
                  padding: "16px",
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
                  borderRadius: "8px",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.82rem",
                  color: "var(--accent-blue)",
                  lineHeight: 1.5,
                  overflowX: "auto",
                }}
              >
                {generatedCliCmd || "Select a supported suite, registered prompt and strategy, and enter a model ID."}
              </pre>

              <button
                onClick={() => void copyCliCommand()}
                disabled={!generatedCliCmd}
                style={{
                  position: "absolute",
                  top: "10px",
                  right: "10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  background: cliCopied ? "rgba(34, 197, 94, 0.2)" : "rgba(255, 255, 255, 0.1)",
                  border: "1px solid var(--border-color, rgba(255, 255, 255, 0.2))",
                  borderRadius: "6px",
                  color: cliCopied ? "var(--accent-emerald)" : "var(--text-primary)",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {cliCopied ? <Check size={14} /> : <Copy size={14} />}
                {cliCopied ? "Copied" : "Copy"}
              </button>
            </div>
            {cliCopyError && <p className="settings-inline-error" role="alert">{cliCopyError}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setCliSuite(null)}
                style={{
                  padding: "8px 18px",
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid var(--border-color, rgba(255, 255, 255, 0.15))",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  fontSize: "0.86rem",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Suite Modal */}
      {isUploadOpen && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeUpload()}>
          <div
            ref={uploadDialogRef}
            className="settings-modal-card suite-manager__modal suite-manager__modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="suite-upload-title"
            tabIndex={-1}
            style={{
              maxWidth: "650px",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <UploadCloud size={20} style={{ color: "var(--accent-lime)" }} aria-hidden="true" />
                <h3 id="suite-upload-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  Import Benchmark Questions
                </h3>
              </div>
              <button
                onClick={closeUpload}
                className="settings-icon-button"
                aria-label="Close import dialog"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
              Select the existing parent suite, then import one category and its questions from Global JSON or CSV. Parent suites always remain empty containers.
            </p>

            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${dragOver ? "var(--accent-lime)" : "var(--border-default)"}`,
                borderRadius: "12px",
                padding: "32px 20px",
                textAlign: "center",
                background: dragOver ? "rgba(224, 255, 2, 0.04)" : "rgba(255, 255, 255, 0.02)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onClick={() => document.getElementById("suite-file-input")?.click()}
            >
              <input
                id="suite-file-input"
                type="file"
                accept=".json,.csv"
                style={{ display: "none" }}
                onChange={handleFileInput}
              />
              <UploadCloud size={32} style={{ color: dragOver ? "var(--accent-lime)" : "var(--text-muted)", margin: "0 auto 10px" }} aria-hidden="true" />
              <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "var(--text-primary)" }}>
                {uploadFileName ? uploadFileName : "Click or drag benchmark file here"}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "4px" }}>
                Accepts Global JSON with envelope or CSV files
              </div>
            </div>

            {/* Parsed Suite Preview & Name Editor */}
            {parsedSuite && (
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
                  borderRadius: "10px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                    <CheckCircle2 size={16} style={{ color: "var(--accent-emerald)" }} aria-hidden="true" />
                    {parsedSuite.valid_count > 0 ? `${parsedSuite.valid_count} questions ready` : "File needs correction"}
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                    source id: {parsedSuite.suite_id || "missing"}
                  </span>
                </div>

                <div className="settings-form-grid">
                  <div>
                    <label style={{ fontSize: "0.76rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Import into</label>
                    <select
                      value={uploadParentSuiteId}
                      onChange={(e) => {
                        const parentId = e.target.value;
                        setUploadParentSuiteId(parentId);
                        const parent = suites.find((suite) => suite.id === parentId);
                        if (parent) setCustomDomain(parent.domain);
                      }}
                      style={{ width: "100%", padding: "7px 10px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "0.85rem" }}
                    >
                      <option value="" disabled>Select a parent suite</option>
                      {suites.map((suite) => <option key={suite.id} value={suite.id}>{suite.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.76rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Suite / category ID</label>
                    <input type="text" value={customSuiteId} onChange={(e) => setCustomSuiteId(e.target.value)} placeholder="arabicmmlu" style={{ width: "100%", padding: "7px 10px", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-color, rgba(255,255,255,0.15))", borderRadius: "6px", color: "var(--text-primary)", fontSize: "0.85rem" }} />
                  </div>
                </div>

                <div className="suite-manager__import-grid">
                  <div>
                    <label style={{ fontSize: "0.76rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                      Suite Display Name (Editable)
                    </label>
                    <input
                      type="text"
                      value={customSuiteName}
                      onChange={(e) => setCustomSuiteName(e.target.value)}
                      placeholder="e.g. Customer Support Evaluation"
                      style={{
                        width: "100%",
                        padding: "7px 10px",
                        background: "rgba(0, 0, 0, 0.3)",
                        border: "1px solid var(--border-color, rgba(255, 255, 255, 0.15))",
                        borderRadius: "6px",
                        color: "var(--text-primary)",
                        fontSize: "0.85rem",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.76rem", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                      Domain
                    </label>
                    <input
                      type="text"
                      value={customDomain}
                      onChange={(e) => setCustomDomain(e.target.value)}
                      placeholder="e.g. universal_reasoning"
                      style={{
                        width: "100%",
                        padding: "7px 10px",
                        background: "rgba(0, 0, 0, 0.3)",
                        border: "1px solid var(--border-color, rgba(255, 255, 255, 0.15))",
                        borderRadius: "6px",
                        color: "var(--text-primary)",
                        fontSize: "0.85rem",
                      }}
                    />
                  </div>
                </div>

                <label style={{ display: "inline-flex", alignItems: "center", gap: "7px", color: "var(--text-primary)", fontSize: "0.8rem" }}>
                  <input type="checkbox" checked={uploadRequired} onChange={(e) => setUploadRequired(e.target.checked)} />
                  Required in Category Results for future runs
                </label>

                {parsedSuite.errors.length > 0 && (
                  <div
                    style={{
                      background: "rgba(244, 63, 94, 0.1)",
                      border: "1px solid rgba(244, 63, 94, 0.2)",
                      borderRadius: "6px",
                      padding: "10px",
                      fontSize: "0.8rem",
                      color: "#f43f5e",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: "4px" }}>{parsedSuite.errors.length} validation issues skipped:</div>
                    <ul style={{ margin: 0, paddingLeft: "18px" }}>
                      {parsedSuite.errors.slice(0, 3).map((err, i) => (
                        <li key={i}>
                          Task {err.task_id || `#${err.task_index}`}: {err.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Submit & Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={closeUpload}
                disabled={uploading}
                style={{
                  padding: "8px 16px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
                  borderRadius: "8px",
                  color: "var(--text-muted)",
                  fontSize: "0.86rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                onClick={() => void submitSuiteUpload()}
                disabled={!parsedSuite || uploading || parsedSuite.valid_count === 0 || !customSuiteId.trim() || !uploadParentSuiteId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 20px",
                  background: "#e0ff02",
                  border: "none",
                  borderRadius: "8px",
                  color: "#000",
                  fontSize: "0.86rem",
                  fontWeight: 700,
                  cursor: !parsedSuite || uploading || !customSuiteId.trim() || !uploadParentSuiteId ? "not-allowed" : "pointer",
                  opacity: !parsedSuite || uploading || !customSuiteId.trim() || !uploadParentSuiteId ? 0.6 : 1,
                }}
              >
                {uploading ? <RefreshCw size={15} className="animate-spin" /> : <UploadCloud size={15} />}
                {uploading ? "Importing..." : "Import Category"}
              </button>
            </div>
          </div>
        </div>
      )}

      {taskEditor && (
        <div className="settings-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTaskEditor(null)}>
          <div ref={taskDialogRef} className="settings-modal-card suite-manager__modal suite-manager__modal--wide" role="dialog" aria-modal="true" aria-labelledby="task-editor-title" tabIndex={-1} style={{ maxWidth: "680px", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              <div><h3 id="task-editor-title" style={{ margin: 0, color: "var(--text-primary)" }}>{taskEditor.mode === "add" ? "Add task" : "Edit task"}</h3><p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: "0.82rem" }}>Suite: {taskEditor.suite.name}</p></div>
              <button onClick={() => setTaskEditor(null)} className="settings-icon-button" aria-label="Close task editor"><X size={17} aria-hidden="true" /></button>
            </div>
            <div style={{ display: "grid", gap: "14px" }}>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Task ID<input value={taskEditor.task.id} disabled={taskEditor.mode === "edit"} onChange={(e) => setTaskEditor({ ...taskEditor, task: { ...taskEditor.task, id: e.target.value } })} style={{ width: "100%", marginTop: "6px", padding: "9px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-color, rgba(255,255,255,0.1))", borderRadius: "7px", color: "var(--text-primary)" }} /></label>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Prompt<textarea value={taskEditor.task.prompt} onChange={(e) => setTaskEditor({ ...taskEditor, task: { ...taskEditor.task, prompt: e.target.value } })} rows={5} style={{ width: "100%", marginTop: "6px", padding: "9px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-color, rgba(255,255,255,0.1))", borderRadius: "7px", color: "var(--text-primary)", resize: "vertical" }} /></label>
              <label style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Expected answer<textarea value={typeof taskEditor.task.expected_answer === "string" ? taskEditor.task.expected_answer : JSON.stringify(taskEditor.task.expected_answer)} onChange={(e) => setTaskEditor({ ...taskEditor, task: { ...taskEditor.task, expected_answer: e.target.value } })} rows={3} style={{ width: "100%", marginTop: "6px", padding: "9px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-color, rgba(255,255,255,0.1))", borderRadius: "7px", color: "var(--text-primary)", resize: "vertical" }} /></label>
              <div className="settings-form-grid">
                <label style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Scorer<select aria-describedby="task-scorer-help" value={taskEditor.task.task_type} disabled={availableScorers.size === 0} onChange={(e) => setTaskEditor({ ...taskEditor, task: { ...taskEditor.task, task_type: e.target.value } })} style={{ width: "100%", marginTop: "6px", padding: "9px 10px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>{!availableScorers.has(taskEditor.task.task_type) && <option value={taskEditor.task.task_type} disabled>{taskEditor.task.task_type} (unavailable)</option>}{scorerDefinitions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
                <label style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Category<input value={taskEditor.task.category_id} onChange={(e) => setTaskEditor({ ...taskEditor, task: { ...taskEditor.task, category_id: e.target.value } })} style={{ width: "100%", marginTop: "6px", padding: "9px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-color, rgba(255,255,255,0.1))", borderRadius: "7px", color: "var(--text-primary)" }} /></label>
              </div>
              {expectedAnswerError && <p role="alert">{expectedAnswerError}</p>}
              {selectedScorer && <div id="task-scorer-help" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                <p>{selectedScorer.description}</p>
                <p>{selectedScorer.configuration}</p>
                <details><summary>Show reference example</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(selectedScorer.example, null, 2)}</pre></details>
              </div>}
              {!availableScorers.has(taskEditor.task.task_type) && <p role="alert">This task's scorer is unavailable. Choose a supported scorer before saving; existing stored data is preserved.</p>}
              <label htmlFor="task-scoring-config" style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Scoring configuration (JSON)</label>
              <textarea id="task-scoring-config" value={scoringConfigText} onChange={(event) => setScoringConfigText(event.target.value)} onBlur={() => setScoringConfigTouched(true)} aria-invalid={scoringConfigTouched && Boolean(scoringConfigError)} aria-describedby="task-scoring-config-help task-scoring-config-error" rows={6} spellCheck={false} style={{ width: "100%", padding: "9px 10px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", resize: "vertical" }} />
              <small id="task-scoring-config-help">Parameters are saved through the task API. Enter a JSON object; leave blank to clear.</small>
              <small id="task-scoring-config-error" role={scoringConfigTouched && scoringConfigError ? "alert" : undefined}>{scoringConfigTouched && scoringConfigError}</small>
            </div>
            <div className="settings-modal-actions"><button onClick={() => setTaskEditor(null)} className="settings-btn-secondary">Cancel</button><button onClick={() => void saveTask()} disabled={savingTask || !taskEditor.task.id || !taskEditor.task.prompt || Boolean(scoringConfigError) || Boolean(expectedAnswerError) || !availableScorers.has(taskEditor.task.task_type)} className="settings-btn-primary">{savingTask ? "Saving…" : "Save task"}</button></div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete?.type === "task"}
        title="Remove task?"
        description={pendingDelete?.type === "task"
              ? `Remove “${pendingDelete.task.id}” from “${pendingDelete.suite.name}”? Existing benchmark history is preserved.`
              : ""}
        confirmLabel="Remove task"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete?.type === "task") void deleteTask(pendingDelete.suite, pendingDelete.task);
        }}
      />
      <RegistryDeleteDialog resource="suites"
        label={pendingDelete?.type === "category" ? "category" : "suite"}
        entry={pendingDelete?.type === "suite" ? pendingDelete.suite : pendingDelete?.type === "category" ? pendingDelete.category : null}
        onCancel={() => setPendingDelete(null)}
        onDeleted={(impact) => {
          onNotify(`Configuration and ${impact.task_count} tasks deleted. Recorded results are unchanged.`);
          setPendingDelete(null);
          setInspectingSuite(null);
          void loadSuites();
        }}
      />
    </section>
  );
}
