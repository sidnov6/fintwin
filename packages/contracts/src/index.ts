export type DecimalString = `${number}.${number}`;

export type EvidenceRef = {
  sourceId: string;
  label: string;
  observedAt: string;
};

export type Metric = {
  label: string;
  value: string;
  trend?: string;
  tone: "positive" | "neutral" | "attention";
  sourceIds: string[];
};

export type ApiEnvelope<T> = {
  ok: boolean;
  data: T;
  as_of: string;
  twin_version: number;
  source_ids: string[];
  assumptions: string[];
  warnings: string[];
  engine_version: string | null;
  correlation_id: string;
};

export type TwinFact = {
  fact_id: string;
  path: string;
  value: string | number;
  label: string;
  source_type: "user_confirmed" | "synthetic_feed" | "derived" | "inferred";
  source_ids: string[];
  observed_at: string;
  effective_from: string;
  confidence: DecimalString;
  verification_status: "proposed" | "confirmed" | "verified" | "superseded";
};

export type ReviewDomain = {
  domain: string;
  status: "reviewed" | "attention" | "incomplete" | "not_in_demo";
  title: string;
  why: string;
  evidence_ids: string[];
  missing_facts: string[];
  question: string | null;
};

export type ScenarioRun<TInputs, TResult> = {
  run_id: string;
  kind: "mortgage" | "retirement" | "child_goal";
  inputs: TInputs;
  result: TResult;
  twin_version: number;
  created_at: string;
};

export type CopilotClaim = { text: string; source_ids: string[]; confidence: DecimalString };
export type CopilotResponse = {
  display_response: string;
  claims: CopilotClaim[];
  tool_calls: { name: string; trace_id: string }[];
  assumptions: string[];
  warnings: string[];
  policy_result: "allowed" | "blocked";
  requires_human_review: boolean;
  mode: "scripted_fallback";
};
