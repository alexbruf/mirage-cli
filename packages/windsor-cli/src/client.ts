// Windsor.ai Connectors REST API client. Read-only: every call is a GET.
// Docs: https://windsor.ai/api-documentation/

export type Row = Record<string, unknown>;

const CONNECTORS = "https://connectors.windsor.ai";
const ONBOARD = "https://onboard.windsor.ai/api";

export class WindsorClient {
  constructor(private readonly apiKey: string) {}

  async listConnectors(): Promise<string[]> {
    return unwrap(await this.get(`${CONNECTORS}/list_connectors`, {})) as string[];
  }

  /** Connected accounts for one connector, or every connector when omitted. */
  async listAccounts(connector?: string): Promise<Row[]> {
    return unwrap(await this.get(`${ONBOARD}/common/ds-accounts`, { datasource: connector ?? "all" }));
  }

  /** Fields a connector exposes, including this account's custom fields. */
  async listFields(connector: string): Promise<Row[]> {
    return unwrap(await this.get(`${CONNECTORS}/${encodeURIComponent(connector)}/fields`, {}));
  }

  /** Connector-specific options, passed back to `query` as extra params. */
  async listOptions(connector: string): Promise<Row[]> {
    return unwrap(await this.get(`${CONNECTORS}/${encodeURIComponent(connector)}/options`, {}));
  }

  async listCustomFields(): Promise<Row[]> {
    return unwrap(await this.get(`${ONBOARD}/custom-fields`, {}));
  }

  async query(connector: string, params: Record<string, string>): Promise<Row[]> {
    const res = await this.get(`${CONNECTORS}/${encodeURIComponent(connector)}`, {
      ...params,
      _renderer: "json",
    });
    return unwrap(res);
  }

  /** The request URL with the key redacted, for `--explain`. */
  static explainUrl(connector: string, params: Record<string, string>): string {
    const url = new URL(`${CONNECTORS}/${encodeURIComponent(connector)}`);
    url.searchParams.set("api_key", "***");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(path);
    url.searchParams.set("api_key", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, { headers: { "User-Agent": "windsor-cli/0.1" } });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Windsor returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || json?.error) {
      const err = json?.error;
      const msg =
        (typeof err === "object" && err !== null ? err.message : err) ?? json?.detail ?? `HTTP ${res.status}`;
      throw new Error(`Windsor API error: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    return json;
  }
}

function unwrap(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.result)) return res.result;
  return [];
}
