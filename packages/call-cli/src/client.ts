import { getCliConfig } from "./shared/config.ts";
import type {
  CallState,
  AudioMeta,
  HealthResponse,
} from "./shared/types.ts";

export class CallClient {
  private baseUrl: string;
  private authHeaders: Record<string, string>;

  constructor(serverUrl?: string) {
    const config = getCliConfig();
    this.baseUrl = (serverUrl ?? config.serverUrl).replace(/\/$/, "");
    this.authHeaders = {};
    if (config.apiKey) {
      this.authHeaders["X-API-Key"] = config.apiKey;
    }
  }

  private async request<T>(
    path: string,
    options?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders,
        ...options?.headers,
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      let msg: string;
      try {
        msg = JSON.parse(body).error ?? body;
      } catch {
        msg = body;
      }
      throw new Error(`${resp.status}: ${msg}`);
    }

    return resp.json() as Promise<T>;
  }

  async health(): Promise<HealthResponse> {
    return this.request("/health");
  }

  async initiateCall(
    phone: string,
    audioId: string,
    silencePrefixSecs?: number,
  ): Promise<CallState> {
    return this.request("/calls", {
      method: "POST",
      body: JSON.stringify({
        phone,
        audio_id: audioId,
        silence_prefix_secs: silencePrefixSecs,
      }),
    });
  }

  async getCallStatus(id: string): Promise<CallState> {
    return this.request(`/calls/${id}`);
  }

  async hangup(id: string): Promise<CallState> {
    return this.request(`/calls/${id}`, { method: "DELETE" });
  }

  async tts(
    text: string,
    voiceId?: string,
    modelId?: string,
  ): Promise<AudioMeta> {
    return this.request("/audio/tts", {
      method: "POST",
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        model_id: modelId,
      }),
    });
  }

  async uploadAudio(filePath: string): Promise<AudioMeta> {
    const file = Bun.file(filePath);
    const formData = new FormData();
    formData.append("file", file);

    const url = `${this.baseUrl}/audio/upload`;
    const resp = await fetch(url, {
      method: "POST",
      body: formData,
      headers: { ...this.authHeaders },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Upload failed (${resp.status}): ${body}`);
    }

    return resp.json() as Promise<AudioMeta>;
  }
}
