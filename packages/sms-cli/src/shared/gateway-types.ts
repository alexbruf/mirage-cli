// Types matching the Go SMS Gateway server's API contracts.
// Must use camelCase JSON to stay compatible with the Android app.

export type ProcessingState =
  | "Pending"
  | "Processed"
  | "Sent"
  | "Delivered"
  | "Failed";

export type MessageEvent =
  | "sms:received"
  | "sms:sent"
  | "sms:delivered"
  | "sms:failed"
  | "system:ping";

// ── Mobile API (Android app ↔ server) ──

export interface MobileRegisterRequest {
  name?: string;
  pushToken?: string;
}

export interface MobileRegisterResponse {
  id: string;
  token: string;
  login: string;
  password: string;
}

export interface MobileDeviceResponse {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSeen: string;
}

export interface MobilePatchDeviceRequest {
  id: string;
  name?: string;
  pushToken?: string;
}

export interface RecipientState {
  phoneNumber: string;
  state: ProcessingState;
  error?: string;
}

export interface MobileMessage {
  id: string;
  message: string;
  phoneNumbers: string[];
  simNumber?: number;
  withDeliveryReport?: boolean;
  isEncrypted?: boolean;
  validUntil?: string;
}

export interface MobileGetMessagesResponse {
  messages: MobileMessage[];
}

export interface MobilePatchMessageRequest {
  id: string;
  state: ProcessingState;
  recipients: RecipientState[];
}

// ── 3rd-party API (external tools ↔ server) ──

export interface ThirdPartySendRequest {
  message?: string;
  textMessage?: { text: string };
  phoneNumbers: string[];
  simNumber?: number;
  withDeliveryReport?: boolean;
  isEncrypted?: boolean;
  ttl?: number;
}

export interface ThirdPartyMessageState {
  id: string;
  state: ProcessingState;
  isHashed: boolean;
  isEncrypted: boolean;
  recipients: RecipientState[];
}

export interface ThirdPartyDevice {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSeen: string;
}

// ── Webhooks ──

export interface GatewayWebhook {
  id: string;
  url: string;
  event: MessageEvent;
}

export interface GatewayWebhookCreateRequest {
  url: string;
  event: MessageEvent;
}

// ── Device settings ──

export interface DeviceSettings {
  messages: {
    processingOrder: "FIFO" | "LIFO";
  };
  ping: {
    intervalSeconds: number;
  };
  webhooks: {
    signingKey: string;
    retryCount: number;
    retryIntervalSeconds: number;
  };
  encryption?: {
    passphrase: string;
  };
}

// ── Push (upstream relay) ──

export interface UpstreamPushPayload {
  token: string;
  event: string;
  data?: Record<string, unknown>;
}

// ── SSE events ──

export interface SseEvent {
  event: string;
  data: string;
}

// ── Database row types (internal) ──

export interface DbUser {
  id: string;
  login: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface DbDevice {
  id: string;
  user_id: string;
  name: string;
  push_token: string | null;
  auth_token: string;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface DbGatewayMessage {
  id: string;
  ext_id: string | null;
  device_id: string | null;
  user_id: string;
  state: ProcessingState;
  phone_numbers: string; // JSON array
  text: string;
  sim_number: number;
  is_encrypted: number;
  with_delivery_report: number;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessageRecipient {
  id: number;
  message_id: string;
  phone_number: string;
  state: ProcessingState;
  error: string | null;
}

export interface DbGatewayWebhook {
  id: string;
  user_id: string;
  device_id: string | null;
  url: string;
  event: string;
}
