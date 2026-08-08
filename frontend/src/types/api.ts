// OpenAPI (specification/docs/api-design/openapi.yaml) の components/schemas に対応する型定義
// このファイルは共通基盤。画面実装で変更しないこと (READ ONLY)

export type Gender = "male" | "female";
export type Role = "member" | "representative";
export type PracticeMonthStatus = "draft" | "voting" | "closed" | "drawn" | "published";
export type AssignedVia =
  | "manager"
  | "grade3"
  | "guaranteed"
  | "distribution"
  | "overflow"
  | "manual";

export interface ApiError {
  code: string;
  message: string;
  details?: { field: string; reason: string }[];
}

// ---------- 認証 ----------

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  address: string;
  phone_number: string;
  grade: number;
  gender: Gender;
  faculty_department: string;
  student_number: string;
  is_manager: boolean;
}

/** メールアドレス確認 (REQ-001.5) */
export interface VerifyEmailRequest {
  email: string;
  /** 6桁の数字 */
  code: string;
}

/** 確認コードの再送 (REQ-001.6) */
export interface ResendVerificationRequest {
  email: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  address: string;
  phone_number: string;
  grade: number;
  gender: Gender;
  faculty_department: string;
  student_number: string;
  is_manager: boolean;
  /** 閲覧専用 (D-039)。投票・抽選・名簿の対象外 */
  is_observer: boolean;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface UserUpdateRequest {
  name?: string;
  address?: string;
  phone_number?: string;
  grade?: number;
  faculty_department?: string;
  student_number?: string;
  is_manager?: boolean;
}

export interface RosterPage {
  items: UserProfile[];
  total: number;
  page: number;
  per_page: number;
}

// ---------- 月別練習・練習日 ----------

export interface Practice {
  id: string;
  practice_date: string; // YYYY-MM-DD
  starts_at: string; // HH:MM
  ends_at: string;
  location: string;
  capacity: number;
  /** 参加できる学年 (D-037)。null は全学年 */
  allowed_grades: number[] | null;
  /** 備考 (D-041)。「練習試合の予定」など */
  note: string | null;
  vote_count: number;
}

export interface PracticeMonth {
  id: string;
  year_month: string; // YYYY-MM
  gender: Gender;
  vote_starts_at: string;
  vote_ends_at: string;
  /** D-015 で廃止（学年別の枠は practices 側で持つ） */
  grade2_ratio: number | null;
  status: PracticeMonthStatus;
  published_at: string | null;
}

export interface PracticeMonthDetail extends PracticeMonth {
  practices: Practice[];
}

export interface PracticeCreateRequest {
  practice_date: string;
  starts_at: string;
  ends_at: string;
  location: string;
  capacity: number;
  /** 参加できる学年。null は全学年 */
  allowed_grades: number[] | null;
  /** 備考。null は記載なし */
  note: string | null;
}

export interface PracticeMonthCreateRequest {
  year_month: string;
  vote_starts_at: string;
  vote_ends_at: string;
  practices: PracticeCreateRequest[];
}

/** よく使う練習の組み合わせ（過去の登録実績から: D-014） */
export interface PracticeSuggestion {
  location: string;
  /** HH:MM */
  starts_at: string;
  /** HH:MM */
  ends_at: string;
  capacity: number;
  use_count: number;
}

// ---------- 投票 ----------

export interface VoteStatus {
  practice_month_id: string;
  voted_practice_ids: string[];
  editable: boolean;
}

// ---------- 抽選・結果 ----------

/** 抽選前の調整画面: ある練習日の、ある学年の投票状況と枠 (D-015) */
export interface GradeVoteSummary {
  grade: number;
  /** その日に投票した人数 */
  voters: number;
  /** 代表が設定済みの参加人数枠。未設定なら null */
  quota: number | null;
  /** 投票数の比率で按分した提案値 */
  suggested_quota: number;
}

export interface PracticeVoteSummary {
  practice_id: string;
  practice_date: string;
  starts_at: string;
  ends_at: string;
  location: string;
  capacity: number;
  /** 参加できる学年 (D-037)。null は全学年 */
  allowed_grades: number[] | null;
  /** 3年 → 1年の順 */
  grades: GradeVoteSummary[];
}

export interface VoteSummary {
  practice_month_id: string;
  /** 全練習日の全学年に枠が設定済みか（抽選できるか） */
  quotas_ready: boolean;
  practices: PracticeVoteSummary[];
}

export interface LotteryExecution {
  id: string;
  practice_month_id: string;
  executed_by: string;
  random_seed: number;
  /** D-015 で廃止。以前の実行履歴のみ値を持つ */
  grade2_ratio: string | number | null;
  is_active: boolean;
  warnings: string[];
  created_at: string;
}

export interface MyResults {
  practice_month_id: string;
  assignments: { practice: Practice }[];
}

/** 練習参加表 (D-025) — 縦にメンバー・横に練習日 */
export interface ParticipationRow {
  user_id: string;
  name: string;
  is_manager: boolean;
  practice_ids: string[];
}

export interface ParticipationGradeSection {
  grade: number;
  rows: ParticipationRow[];
}

export interface ParticipationTable {
  practice_month_id: string;
  year_month: string;
  practices: Practice[];
  grades: ParticipationGradeSection[];
}

export interface Participant {
  assignment_id: string;
  user_id: string;
  name: string;
  grade: number;
  is_manager: boolean;
  assigned_via: AssignedVia;
}

export interface PracticeResults {
  practice: Practice;
  participants: Participant[];
}

export interface MemberResult {
  user_id: string;
  name: string;
  grade: number;
  is_manager: boolean;
  votes_count: number;
  wins_count: number;
  /** 前月の当選/投票。前月の公開実績が無ければ 0 */
  prev_wins_count: number;
  prev_votes_count: number;
  practice_ids: string[];
  /** 投票した練習日。微調整で「この人はこの日に来られるのか」を判断するために使う */
  voted_practice_ids: string[];
}

export interface FullResults {
  by_practice: PracticeResults[];
  by_member: MemberResult[];
}

export interface AssignmentCreated {
  assignment_id: string;
  capacity_exceeded: boolean;
}

// ---------- 設定 ----------

export interface LotterySettings {
  gender: Gender;
  rescue_alpha: string | number;
}
