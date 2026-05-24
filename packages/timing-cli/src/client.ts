import { getToken, getBaseUrl } from "./config.ts";
import type {
  TimingProject,
  TimingEntry,
  TimingTeam,
  TimingTeamMember,
  PaginatedResponse,
  SingleResponse,
  ReportResponse,
  BillingStatus,
} from "./types.ts";

export class TimingClient {
  private token: string;
  private baseUrl: string;
  private timezone?: string;

  constructor(timezone?: string) {
    this.token = getToken();
    this.baseUrl = getBaseUrl();
    this.timezone = timezone;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    params?: URLSearchParams,
    accept = "application/json"
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params && params.toString()) {
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: accept,
    };
    if (this.timezone) {
      headers["X-Time-Zone"] = this.timezone;
    }
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      let msg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const err = JSON.parse(text);
        if (err.message) msg = `${msg} — ${err.message}`;
      } catch {
        if (text) msg = `${msg} — ${text}`;
      }
      throw new Error(msg);
    }

    if (res.status === 204) return undefined as T;

    if (accept === "text/plain") {
      return (await res.text()) as T;
    }

    return (await res.json()) as T;
  }

  private async fetchAllPages<T>(
    path: string,
    params?: URLSearchParams
  ): Promise<T[]> {
    const all: T[] = [];
    const p = params || new URLSearchParams();
    let page = 1;

    while (true) {
      p.set("page", String(page));
      const res = await this.request<PaginatedResponse<T>>("GET", path, undefined, p);
      all.push(...res.data);
      if (!res.links.next || page >= res.meta.last_page) break;
      page++;
    }
    return all;
  }

  // --- Projects ---

  async listProjects(opts?: {
    title?: string;
    hideArchived?: boolean;
    teamId?: string;
    allPages?: boolean;
  }): Promise<PaginatedResponse<TimingProject>> {
    const p = new URLSearchParams();
    if (opts?.title) p.set("title", opts.title);
    if (opts?.hideArchived) p.set("hide_archived", "1");
    if (opts?.teamId) p.set("team_id", opts.teamId);

    if (opts?.allPages) {
      const data = await this.fetchAllPages<TimingProject>("/projects", p);
      return { data, links: { first: null, last: null, prev: null, next: null }, meta: { current_page: 1, from: 1, last_page: 1, per_page: data.length, to: data.length, total: data.length } };
    }
    return this.request<PaginatedResponse<TimingProject>>("GET", "/projects", undefined, p);
  }

  async getProjectHierarchy(opts?: {
    hideArchived?: boolean;
    teamId?: string;
  }): Promise<PaginatedResponse<TimingProject>> {
    const p = new URLSearchParams();
    if (opts?.hideArchived) p.set("hide_archived", "1");
    if (opts?.teamId) p.set("team_id", opts.teamId);
    return this.request<PaginatedResponse<TimingProject>>("GET", "/projects/hierarchy", undefined, p);
  }

  async getProject(id: string): Promise<SingleResponse<TimingProject>> {
    return this.request<SingleResponse<TimingProject>>("GET", `/projects/${id}`);
  }

  async createProject(data: {
    title: string;
    color?: string;
    parent?: string;
    productivityScore?: number;
    isArchived?: boolean;
    notes?: string;
    defaultBillingRate?: number;
    defaultBillingStatus?: BillingStatus;
    teamId?: string;
  }): Promise<SingleResponse<TimingProject>> {
    const body: Record<string, unknown> = { title: data.title };
    if (data.color) body.color = data.color;
    if (data.parent) body.parent = data.parent;
    if (data.productivityScore != null) body.productivity_score = data.productivityScore;
    if (data.isArchived != null) body.is_archived = data.isArchived;
    if (data.notes) body.notes = data.notes;
    if (data.defaultBillingRate != null) body.default_billing_rate = data.defaultBillingRate;
    if (data.defaultBillingStatus) body.default_billing_status = data.defaultBillingStatus;
    if (data.teamId) body.team_id = data.teamId;
    return this.request<SingleResponse<TimingProject>>("POST", "/projects", body);
  }

  async updateProject(
    id: string,
    data: {
      title?: string;
      color?: string;
      parent?: string;
      productivityScore?: number;
      isArchived?: boolean;
      notes?: string;
      defaultBillingRate?: number;
      defaultBillingStatus?: BillingStatus;
    }
  ): Promise<SingleResponse<TimingProject>> {
    const body: Record<string, unknown> = {};
    if (data.title) body.title = data.title;
    if (data.color) body.color = data.color;
    if (data.parent) body.parent = data.parent;
    if (data.productivityScore != null) body.productivity_score = data.productivityScore;
    if (data.isArchived != null) body.is_archived = data.isArchived;
    if (data.notes !== undefined) body.notes = data.notes;
    if (data.defaultBillingRate != null) body.default_billing_rate = data.defaultBillingRate;
    if (data.defaultBillingStatus) body.default_billing_status = data.defaultBillingStatus;
    return this.request<SingleResponse<TimingProject>>("PUT", `/projects/${id}`, body);
  }

  async deleteProject(id: string): Promise<void> {
    await this.request<void>("DELETE", `/projects/${id}`);
  }

  // --- Time Entries ---

  async startTimer(opts?: {
    project?: string;
    title?: string;
    notes?: string;
    billingStatus?: BillingStatus;
  }): Promise<SingleResponse<TimingEntry>> {
    const body: Record<string, unknown> = {};
    if (opts?.project) body.project = opts.project;
    if (opts?.title) body.title = opts.title;
    if (opts?.notes) body.notes = opts.notes;
    if (opts?.billingStatus) body.billing_status = opts.billingStatus;
    return this.request<SingleResponse<TimingEntry>>("POST", "/time-entries/start", body);
  }

  async stopTimer(): Promise<SingleResponse<TimingEntry>> {
    return this.request<SingleResponse<TimingEntry>>("PUT", "/time-entries/stop");
  }

  async getRunning(): Promise<SingleResponse<TimingEntry>> {
    return this.request<SingleResponse<TimingEntry>>("GET", "/time-entries/running");
  }

  async getLatest(): Promise<SingleResponse<TimingEntry>> {
    return this.request<SingleResponse<TimingEntry>>("GET", "/time-entries/latest");
  }

  async listEntries(opts?: {
    startDateMin?: string;
    startDateMax?: string;
    projects?: string[];
    includeChildProjects?: boolean;
    searchQuery?: string;
    billingStatus?: BillingStatus[];
    allPages?: boolean;
  }): Promise<PaginatedResponse<TimingEntry>> {
    const p = new URLSearchParams();
    if (opts?.startDateMin) p.set("start_date_min", opts.startDateMin);
    if (opts?.startDateMax) p.set("start_date_max", opts.startDateMax);
    if (opts?.includeChildProjects) p.set("include_child_projects", "1");
    if (opts?.searchQuery) p.set("search_query", opts.searchQuery);
    if (opts?.projects) {
      for (const proj of opts.projects) p.append("projects[]", proj);
    }
    if (opts?.billingStatus) {
      for (const bs of opts.billingStatus) p.append("billing_status[]", bs);
    }

    if (opts?.allPages) {
      const data = await this.fetchAllPages<TimingEntry>("/time-entries", p);
      return { data, links: { first: null, last: null, prev: null, next: null }, meta: { current_page: 1, from: 1, last_page: 1, per_page: data.length, to: data.length, total: data.length } };
    }
    return this.request<PaginatedResponse<TimingEntry>>("GET", "/time-entries", undefined, p);
  }

  async getEntry(id: string): Promise<SingleResponse<TimingEntry>> {
    return this.request<SingleResponse<TimingEntry>>("GET", `/time-entries/${id}`);
  }

  async createEntry(data: {
    startDate: string;
    endDate: string;
    project?: string;
    title?: string;
    notes?: string;
    billingStatus?: BillingStatus;
    billingRate?: number;
    replaceExisting?: boolean;
  }): Promise<SingleResponse<TimingEntry>> {
    const body: Record<string, unknown> = {
      start_date: data.startDate,
      end_date: data.endDate,
    };
    if (data.project) body.project = data.project;
    if (data.title) body.title = data.title;
    if (data.notes) body.notes = data.notes;
    if (data.billingStatus) body.billing_status = data.billingStatus;
    if (data.billingRate != null) body.billing_rate = data.billingRate;
    if (data.replaceExisting != null) body.replace_existing = data.replaceExisting;
    return this.request<SingleResponse<TimingEntry>>("POST", "/time-entries", body);
  }

  async updateEntry(
    id: string,
    data: {
      startDate?: string;
      endDate?: string;
      project?: string;
      title?: string;
      notes?: string;
      billingStatus?: BillingStatus;
      billingRate?: number;
    }
  ): Promise<SingleResponse<TimingEntry>> {
    const body: Record<string, unknown> = {};
    if (data.startDate) body.start_date = data.startDate;
    if (data.endDate) body.end_date = data.endDate;
    if (data.project) body.project = data.project;
    if (data.title !== undefined) body.title = data.title;
    if (data.notes !== undefined) body.notes = data.notes;
    if (data.billingStatus) body.billing_status = data.billingStatus;
    if (data.billingRate != null) body.billing_rate = data.billingRate;
    return this.request<SingleResponse<TimingEntry>>("PUT", `/time-entries/${id}`, body);
  }

  async deleteEntry(id: string): Promise<void> {
    await this.request<void>("DELETE", `/time-entries/${id}`);
  }

  async batchUpdateEntries(data: {
    entryIds: string[];
    project?: string;
    title?: string;
    notes?: string;
    billingStatus?: BillingStatus;
  }): Promise<void> {
    const body: Record<string, unknown> = {
      time_entry_ids: data.entryIds,
    };
    if (data.project) body.project = data.project;
    if (data.title !== undefined) body.title = data.title;
    if (data.notes !== undefined) body.notes = data.notes;
    if (data.billingStatus) body.billing_status = data.billingStatus;
    await this.request<void>("PATCH", "/time-entries/batch-update", body);
  }

  // --- Reports ---

  async getReport(opts: {
    startDateMin: string;
    startDateMax: string;
    columns?: string[];
    groupBy?: string[];
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    projects?: string[];
    includeChildProjects?: boolean;
    searchQuery?: string;
    billingStatus?: BillingStatus[];
    teamMembers?: string[];
    timespan?: string;
  }): Promise<ReportResponse> {
    const p = new URLSearchParams();
    p.set("start_date_min", opts.startDateMin);
    p.set("start_date_max", opts.startDateMax);
    if (opts.sortBy) p.set("sort_by", opts.sortBy);
    if (opts.sortOrder) p.set("sort_order", opts.sortOrder);
    if (opts.includeChildProjects) p.set("include_child_projects", "1");
    if (opts.searchQuery) p.set("search_query", opts.searchQuery);
    if (opts.timespan) p.set("timespan", opts.timespan);
    if (opts.columns) {
      for (const c of opts.columns) p.append("columns[]", c);
    }
    if (opts.groupBy) {
      for (const g of opts.groupBy) p.append("group_by[]", g);
    }
    if (opts.projects) {
      for (const proj of opts.projects) p.append("projects[]", proj);
    }
    if (opts.billingStatus) {
      for (const bs of opts.billingStatus) p.append("billing_status[]", bs);
    }
    if (opts.teamMembers) {
      for (const tm of opts.teamMembers) p.append("team_members[]", tm);
    }
    return this.request<ReportResponse>("GET", "/report", undefined, p);
  }

  // --- Teams ---

  async listTeams(): Promise<PaginatedResponse<TimingTeam>> {
    return this.request<PaginatedResponse<TimingTeam>>("GET", "/teams");
  }

  async getTeamMembers(teamId: string): Promise<PaginatedResponse<TimingTeamMember>> {
    return this.request<PaginatedResponse<TimingTeamMember>>("GET", `/teams/${teamId}/members`);
  }

  // --- Activity Hierarchy ---

  async getActivityHierarchy(opts: {
    startDate: string;
    endDate: string;
    blockSize?: number;
  }): Promise<string> {
    const p = new URLSearchParams();
    p.set("start_date", opts.startDate);
    p.set("end_date", opts.endDate);
    if (opts.blockSize != null) p.set("block_size", String(opts.blockSize));
    return this.request<string>("GET", "/activity-hierarchy", undefined, p, "text/plain");
  }
}
