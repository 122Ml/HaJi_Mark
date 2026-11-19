export interface Point {
  id: string;
  title: string;
  position: number;
  parent_id: string | null;
  kind: string;
  description: string;
}

export interface Member {
  id: string;
  display_name: string;
  username?: string;
}

export interface Resource {
  id: string;
  title: string;
  content: string;
  source_url: string;
  locator: string;
  status: string;
  version: number;
  knowledge_point_id: string | null;
  source_note: string;
  published_at: string | null;
  supersedes_id?: string | null;
}

export interface Profile {
  id: string;
  label: string;
  kind: string;
  available: boolean;
}

export interface ModelInfo {
  profiles: Profile[];
}

export interface Job {
  id: string;
  kind: string;
  state: string;
  progress: number;
  error: string;
  created_at: string;
  output: Record<string, unknown>;
  input: Record<string, unknown>;
}

export interface Source {
  id: string;
  title: string;
  filename: string;
  state: string;
  parse_state: string;
  parse_error: string;
  parse_revision: number;
  allow_derived: boolean;
  fragment_count?: number;
  review_count?: number;
}

export interface Fragment {
  id: string;
  heading: string;
  body: string;
  locator: Record<string, unknown>;
  quality: string;
}

export interface SourceDetail {
  source: Source;
  fragments: Fragment[];
  display_revision: number;
}

export interface Evidence {
  source_id: string;
  fragment_id: string;
  quote: string;
}

export interface Knowledge {
  origin: "source" | "teacher_example";
  id: string;
  title: string;
  body: string;
  category: string;
  content_kind: string;
  conditions: string;
  state: string;
  version: number;
  edit_version: number;
  evidence: Evidence[];
  student_visible: boolean;
  use_for_learning: boolean;
  use_for_grading: boolean;
  knowledge_point_ids: string[];
  related_ids: string[];
}

export interface Hit {
  id: string;
  title: string;
  heading: string;
  body: string;
  locator: Record<string, unknown>;
  source_id?: string;
  knowledge_id?: string;
  resource_id?: string;
  fragment_ids?: string[];
  score?: number;
}

export interface Citation {
  id: string;
  quote: string;
  ref?: string;
}

export interface AssistAnswer {
  text: string;
  sources: Hit[];
  mode: string;
  status: string;
  citations?: Citation[];
}

export interface Criterion {
  id: string;
  title: string;
  max_score: number;
  rule: string;
  requirement?: string;
  partial_credit?: string;
  acceptable_answers?: string;
  error_conditions?: string;
  evidence_ids?: string[];
}

export interface RubricVersion {
  id: string;
  version: number;
  state: string;
  criteria: Criterion[];
  evidence_refs?: Hit[];
}

export interface PointFeedback {
  criterion_id: string;
  title: string;
  max_score: number;
  score: number;
  feedback: string;
  quote: string;
}

export interface Question {
  id: string;
  prompt: string;
  type: string;
  max_score: number;
  rubric: string;
  options: string[];
  correct_answer?: string;
  knowledge_point_id: string | null;
  resource_id: string | null;
  bank_question_id?: string | null;
  bank_version_id?: string | null;
}

export interface Assignment {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  max_score: number;
  due_at: string | null;
  version: number;
  question_count?: number;
}

export interface Submission {
  id: string;
  assignment_id: string;
  question_id: string;
  student_id: string;
  student_name?: string;
  attempt: number;
  answer_text: string;
  status: string;
  score: number | null;
  feedback: string;
  submitted_at: string;
  assignment_version?: number;
  import_origin?: Record<string, unknown> | null;
}

export interface Revision {
  id: string;
  version: number;
  score: number;
  feedback: string;
  state: string;
  created_at: string;
  rubric_version_id?: string | null;
  point_results?: PointFeedback[];
  evidence_refs?: Hit[];
}

export interface ActiveRegradeNotice {
  id: string;
  state: string;
  reason?: string;
}
