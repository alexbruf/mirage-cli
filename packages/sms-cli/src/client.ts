import { getCliConfig } from "./shared/config.ts";
import type {
  Message,
  Conversation,
  Contact,
  HealthResponse,
  SearchResult,
} from "./shared/types.ts";

export class SmsClient {
  private baseUrl: string;

  constructor(serverUrl?: string) {
    this.baseUrl = serverUrl ?? getCliConfig().serverUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({
        error: res.statusText,
      }))) as Record<string, string>;
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  listMessages(params?: Record<string, string>): Promise<Message[]> {
    const qs = params ? `?${new URLSearchParams(params)}` : "";
    return this.request(`/messages${qs}`);
  }

  getMessage(id: string): Promise<Message> {
    return this.request(`/messages/${encodeURIComponent(id)}`);
  }

  markRead(id: string): Promise<void> {
    return this.request(`/messages/${encodeURIComponent(id)}/read`, {
      method: "POST",
    });
  }

  markUnread(id: string): Promise<void> {
    return this.request(`/messages/${encodeURIComponent(id)}/unread`, {
      method: "POST",
    });
  }

  deleteMessage(id: string): Promise<void> {
    return this.request(`/messages/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  send(phone: string, text: string, sim?: number): Promise<Message> {
    return this.request("/send", {
      method: "POST",
      body: JSON.stringify({ phone, text, sim }),
    });
  }

  listConversations(): Promise<Conversation[]> {
    return this.request("/conversations");
  }

  getConversation(phone: string): Promise<Message[]> {
    return this.request(
      `/conversations/${encodeURIComponent(phone)}`,
    );
  }

  markConversationRead(phone: string): Promise<void> {
    return this.request(
      `/conversations/${encodeURIComponent(phone)}/read`,
      { method: "POST" },
    );
  }

  listContacts(): Promise<Contact[]> {
    return this.request("/contacts");
  }

  addContact(phone: string, name: string): Promise<void> {
    return this.request("/contacts", {
      method: "POST",
      body: JSON.stringify({ phone, name }),
    });
  }

  deleteContact(phone: string): Promise<void> {
    return this.request(
      `/contacts/${encodeURIComponent(phone)}`,
      { method: "DELETE" },
    );
  }

  health(): Promise<HealthResponse> {
    return this.request("/health");
  }

  search(query: string): Promise<SearchResult> {
    return this.request(`/search?q=${encodeURIComponent(query)}`);
  }
}
