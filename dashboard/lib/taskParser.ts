export interface BenchmarkSuite {
  id: string;
  parent_suite_id?: string;
  sla_criteria_id?: string | null;
  sla_criteria?: Record<string, unknown> | null;
  name: string;
  domain: string;
  description?: string;
  default_scorer?: string;
  default_tolerance?: {
    relative: number;
    absolute_floor: number;
  };
  task_count: number;
  task_groups?: Array<{ id: string; name: string; task_count: number; is_required?: boolean }>;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CategoryMetadata {
  category_id: string;
  suite_id?: string;
  parent_suite_id?: string;
  suite_name?: string;
  domain?: string;
  display_name?: string;
  description?: string;
  language?: string;
  default_task_type?: string;
  default_tolerance?: {
    relative: number;
    absolute_floor: number;
  };
  system_prompt?: string;
  attribution?: string;
  source_dataset?: string;
  license?: string;
  status?: string;
  is_required?: boolean;
}

export interface TaskItem {
  id: string;
  suite_id?: string;
  suite_name?: string;
  domain?: string;
  category_id: string;
  prompt: string;
  expected_answer: any;
  task_type: string;
  bucket?: string;
  language?: string;
  tolerance?: {
    relative: number;
    absolute_floor: number;
  };
  scoring_config?: Record<string, any>;
  program?: string;
}

export interface TaskParseDiagnostic {
  task_index: number;
  task_id?: string;
  field: string;
  error: string;
}

export interface TaskSuiteParseResult {
  is_valid: boolean;
  suite_id?: string;
  suite_name?: string;
  domain?: string;
  category_metadata: CategoryMetadata;
  tasks: TaskItem[];
  total_found: number;
  valid_count: number;
  errors: TaskParseDiagnostic[];
}

export const CANONICAL_CATEGORIES = new Set<string>();


export const CATEGORY_ALIASES: Record<string, string> = {};

export function parseScorerCatalog(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("The API returned an invalid scorer catalog");
  }
  return new Set(value);
}

export type ScorerDefinition = {
  id: string;
  name: string;
  description: string;
  configuration: string;
  expected_answer_type: string;
  example: { expected_answer: unknown; scoring_config?: Record<string, unknown>; response: string };
};

export function parseScorerDefinitions(value: unknown): ScorerDefinition[] {
  if (!value || typeof value !== "object" || !("scorers" in value)) throw new Error("Invalid scorer catalog");
  const definitions = (value as { scorers: unknown }).scorers;
  if (!Array.isArray(definitions) || definitions.length === 0 || definitions.some((entry) => !entry || typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.description !== "string" || typeof entry.configuration !== "string" || typeof entry.expected_answer_type !== "string" || !entry.example || !("expected_answer" in entry.example))) {
    throw new Error("The API returned invalid scorer descriptions");
  }
  return definitions;
}

export function parseExpectedAnswer(value: unknown, scorer: ScorerDefinition | undefined): unknown {
  if (!scorer) throw new Error("Choose an available scorer");
  if (typeof value !== "string") return value;
  if (scorer.expected_answer_type === "list" || scorer.expected_answer_type === "dict") {
    if (scorer.id === "keyword_match" && !value.trim().startsWith("[")) return value;
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { throw new Error("Expected answer must be valid JSON for this scorer"); }
    if (scorer.expected_answer_type === "list" ? !Array.isArray(parsed) : !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Expected answer must be a JSON ${scorer.expected_answer_type === "list" ? "array" : "object"}`);
    }
    return parsed;
  }
  if (scorer.expected_answer_type === "int" || scorer.expected_answer_type === "float") {
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error("Expected answer must be a finite number");
    return Number(value);
  }
  return value;
}

export function parseScoringConfig(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scoring configuration must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function normalizeCategoryId(rawId: string | null | undefined): string {
  if (!rawId) return "general";
  const normalized = rawId.trim().toLowerCase().replace(/\s+/g, "_");
  return CATEGORY_ALIASES[normalized] || normalized;
}

export function parseGlobalTaskSuite(jsonTextOrObj: string | Record<string, any>, availableScorers: ReadonlySet<string>): TaskSuiteParseResult {
  let data: Record<string, any>;
  if (typeof jsonTextOrObj === "string") {
    try {
      data = JSON.parse(jsonTextOrObj);
    } catch (e: any) {
      return {
        is_valid: false,
        category_metadata: { category_id: "general" },
        tasks: [],
        total_found: 0,
        valid_count: 0,
        errors: [{ task_index: -1, field: "root", error: `Invalid JSON syntax: ${e.message}` }],
      };
    }
  } else {
    data = jsonTextOrObj;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      is_valid: false,
      category_metadata: { category_id: "general" },
      tasks: [],
      total_found: 0,
      valid_count: 0,
      errors: [{ task_index: -1, field: "root", error: "Input payload must be a JSON object" }],
    };
  }

  const errors: TaskParseDiagnostic[] = [];

  // 1. Resolve Category Metadata & Suite Information
  const rawMeta = (data.category_metadata && typeof data.category_metadata === "object")
    ? data.category_metadata
    : data;

  const rawSuiteId = rawMeta.suite_id || data.suite_id || rawMeta.category_id || data.category_id || data.benchmark_name;
  const rawSuiteName = rawMeta.suite_name || data.suite_name || rawMeta.name || data.name || rawMeta.display_name || rawMeta.benchmark_name;
  const rawDomain = rawMeta.domain || data.domain || rawMeta.category_id || data.category_id || "general";

  const categoryId = normalizeCategoryId(rawDomain || rawSuiteId);
  const suiteId = String(rawSuiteId || categoryId).trim().toLowerCase().replace(/\s+/g, "_");
  const suiteName = String(rawSuiteName || suiteId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).trim();
  const domain = String(rawDomain || categoryId).trim().toLowerCase();

  const categoryMetadata: CategoryMetadata = {
    category_id: categoryId,
    suite_id: suiteId,
    parent_suite_id: rawMeta.parent_suite_id || data.parent_suite_id,
    suite_name: suiteName,
    domain: domain,
    display_name: suiteName,
    description: rawMeta.description,
    language: rawMeta.language || "en",
    default_task_type: rawMeta.default_task_type || "grounded_answer",
    default_tolerance: rawMeta.default_tolerance || rawMeta.tolerance || { relative: 0.001, absolute_floor: 0.005 },
    system_prompt: rawMeta.system_prompt,
    attribution: rawMeta.attribution,
    source_dataset: rawMeta.source_dataset,
    license: rawMeta.license,
    status: rawMeta.status || "approval_ready",
    is_required: rawMeta.is_required ?? data.is_required,
  };

  // 2. Resolve Tasks List
  const rawTasks = Array.isArray(data.content) ? data.content : (Array.isArray(data.tasks) ? data.tasks : null);
  if (!rawTasks) {
    return {
      is_valid: false,
      suite_id: suiteId,
      suite_name: suiteName,
      domain: domain,
      category_metadata: categoryMetadata,
      tasks: [],
      total_found: 0,
      valid_count: 0,
      errors: [{ task_index: -1, field: "content", error: "Missing 'content' or 'tasks' array in payload" }],
    };
  }

  const validatedTasks: TaskItem[] = [];
  const seenIds = new Set<string>();

  const standardKeys = new Set([
    "id", "suite_id", "suite_name", "domain", "category_id", "task_category",
    "prompt", "expected_answer", "task_type", "bucket", "language", "tolerance",
    "program", "scoring_config",
  ]);

  rawTasks.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      errors.push({ task_index: idx, field: "item", error: "Task item must be an object" });
      return;
    }

    const id = typeof item.id === "string" ? item.id.trim() : null;
    if (!id) {
      errors.push({ task_index: idx, field: "id", error: "Missing or invalid 'id'" });
      return;
    }
    if (seenIds.has(id)) {
      errors.push({ task_index: idx, task_id: id, field: "id", error: `Duplicate task id '${id}'` });
      return;
    }
    seenIds.add(id);

    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (!prompt) {
      errors.push({ task_index: idx, task_id: id, field: "prompt", error: "Prompt must be a non-empty string" });
      return;
    }

    const taskType = item.task_type || categoryMetadata.default_task_type || "numeric_tolerance";
    if (!availableScorers.has(taskType)) {
      errors.push({
        task_index: idx,
        task_id: id,
        field: "task_type",
        error: `Unknown task_type '${taskType}'`,
      });
      return;
    }

    let expectedAnswer = item.expected_answer;
    if (expectedAnswer === undefined || expectedAnswer === null) {
      expectedAnswer = item.expected_json ?? item.expected_safe_behavior ?? item.reference_answer ?? item.answer;
    }
    if (expectedAnswer === undefined || expectedAnswer === null) {
      errors.push({ task_index: idx, task_id: id, field: "expected_answer", error: "Missing 'expected_answer'" });
      return;
    }

    if (taskType === "numeric_tolerance" || taskType === "numeric_exact") {
      const num = Number(expectedAnswer);
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        errors.push({
          task_index: idx,
          task_id: id,
          field: "expected_answer",
          error: `Expected answer must be a finite number for ${taskType} (got ${expectedAnswer})`,
        });
        return;
      }
      expectedAnswer = num;
    }

    const taskCat = normalizeCategoryId(item.category_id || item.task_category || categoryMetadata.category_id);
    const taskLang = item.language || categoryMetadata.language || "en";
    const tolerance = item.tolerance || (taskType === "numeric_tolerance" ? categoryMetadata.default_tolerance : undefined);
    const bucket = item.bucket || "general";

    let scoringConfig = item.scoring_config;
    if (!scoringConfig || typeof scoringConfig !== "object") {
      scoringConfig = {};
    } else {
      scoringConfig = { ...scoringConfig };
    }

    // Preserve all non-standard task attributes into scoringConfig
    Object.keys(item).forEach((k) => {
      if (!standardKeys.has(k) && scoringConfig[k] === undefined) {
        scoringConfig[k] = item[k];
      }
    });

    if (Object.keys(scoringConfig).length === 0) {
      scoringConfig = undefined;
    }

    validatedTasks.push({
      id,
      suite_id: item.suite_id || suiteId,
      suite_name: item.suite_name || suiteName,
      domain: item.domain || domain,
      category_id: taskCat,
      prompt,
      expected_answer: expectedAnswer,
      task_type: taskType,
      bucket,
      language: taskLang,
      tolerance,
      scoring_config: scoringConfig,
      program: item.program,
    });
  });

  return {
    is_valid: errors.length === 0 && validatedTasks.length > 0,
    suite_id: suiteId,
    suite_name: suiteName,
    domain: domain,
    category_metadata: categoryMetadata,
    tasks: validatedTasks,
    total_found: rawTasks.length,
    valid_count: validatedTasks.length,
    errors,
  };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseCsvJsonCell(value: string | undefined): any {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function parseTaskSuiteFile(text: string, fileName: string, availableScorers: ReadonlySet<string>): TaskSuiteParseResult {
  if (!fileName.toLowerCase().endsWith(".csv")) return parseGlobalTaskSuite(text, availableScorers);
  try {
    const rows = parseCsvRows(text);
    if (rows.length < 2) {
      return {
        is_valid: false,
        category_metadata: { category_id: "general" },
        tasks: [],
        total_found: 0,
        valid_count: 0,
        errors: [{ task_index: -1, field: "root", error: "CSV must contain a header and at least one task row" }],
      };
    }
    const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
    const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
    const first = records[0];
    const suiteId = first.suite_id || first.category_id || first.task_category;
    const suiteName = first.suite_name || first.display_name || first.name || suiteId;
    const tasks = records.map((record) => {
      const tolerance = parseCsvJsonCell(record.tolerance) || (
        record.relative_tolerance
          ? { relative: Number(record.relative_tolerance), absolute_floor: Number(record.absolute_floor || 0.005) }
          : undefined
      );
      return {
        id: record.id || record.task_id,
        suite_id: record.suite_id || suiteId,
        suite_name: record.suite_name || suiteName,
        domain: record.domain || first.domain,
        category_id: record.category_id || record.task_category || suiteId,
        prompt: record.prompt,
        expected_answer: parseCsvJsonCell(record.expected_answer || record.answer || record.reference_answer),
        task_type: record.task_type || first.default_task_type,
        bucket: record.bucket,
        language: record.language || first.language,
        tolerance,
        scoring_config: parseCsvJsonCell(record.scoring_config),
        program: record.program || undefined,
      };
    });
    return parseGlobalTaskSuite({
      suite_id: suiteId,
      suite_name: suiteName,
      domain: first.domain || "general",
      parent_suite_id: first.parent_suite_id || undefined,
      is_required: first.is_required ? ["true", "1", "yes"].includes(first.is_required.toLowerCase()) : undefined,
      category_metadata: {
        category_id: suiteId,
        suite_id: suiteId,
        suite_name: suiteName,
        domain: first.domain || "general",
        parent_suite_id: first.parent_suite_id || undefined,
        description: first.description || undefined,
        language: first.language || "en",
        default_task_type: first.default_task_type || first.task_type || "grounded_answer",
        is_required: first.is_required ? ["true", "1", "yes"].includes(first.is_required.toLowerCase()) : undefined,
      },
      tasks,
    }, availableScorers);
  } catch (error: any) {
    return {
      is_valid: false,
      category_metadata: { category_id: "general" },
      tasks: [],
      total_found: 0,
      valid_count: 0,
      errors: [{ task_index: -1, field: "root", error: error?.message || "CSV parsing failed" }],
    };
  }
}
