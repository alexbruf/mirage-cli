export type CallStatus =
  | "initiating"
  | "ringing"
  | "playing"
  | "completed"
  | "failed";

export interface CallState {
  id: string;
  phone: string;
  status: CallStatus;
  audio_id: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface AudioMeta {
  id: string;
  original_name: string;
  duration_secs: number;
  path: string;
}

export interface HealthResponse {
  status: "ok" | "error";
  active_calls: number;
  bluetooth_connected: boolean;
}
