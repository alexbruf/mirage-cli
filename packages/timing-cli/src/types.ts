export interface TimingProject {
  self: string;
  type: "project";
  title: string;
  title_chain: string[];
  color: string;
  productivity_score: number | null;
  is_archived: boolean;
  notes: string | null;
  default_billing_rate: number | null;
  default_billing_status: BillingStatus | null;
  parent: { self: string } | null;
  team: { self: string } | null;
  children: TimingProject[];
  custom_fields: Record<string, string>;
}

export type BillingStatus =
  | "undetermined"
  | "not_billable"
  | "billable"
  | "billed"
  | "paid";

export interface TimingEntry {
  self: string;
  type: "time-entry";
  start_date: string;
  end_date: string;
  duration: number;
  title: string | null;
  notes: string | null;
  is_running: boolean;
  billing_status: BillingStatus;
  billing_rate: number | null;
  billing_amount: number | null;
  project: { self: string; title?: string } | null;
  custom_fields: Record<string, string>;
}

export interface TimingTeam {
  self: string;
  type: "team";
  name: string;
}

export interface TimingTeamMember {
  self: string;
  type: "team-membership";
  email: string;
  role: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  links: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    from: number | null;
    last_page: number;
    per_page: number;
    to: number | null;
    total: number;
  };
}

export interface SingleResponse<T> {
  data: T;
}

export interface ReportEntry {
  project: { self: string } | null;
  time_entries: number;
  duration: number;
  title: string | null;
  billing_amount: number | null;
  children?: ReportEntry[];
}

export interface ReportResponse {
  data: ReportEntry[];
}

export type OutputFormat = "json" | "table";

export interface GlobalOptions {
  format: OutputFormat;
  timezone?: string;
}
