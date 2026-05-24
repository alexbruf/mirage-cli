export type Direction = "in" | "out";

export interface Message {
  id: string;
  phone_number: string;
  text: string;
  direction: Direction;
  timestamp: string;
  read: boolean;
  sim_number: number;
}

export interface Contact {
  phone_number: string;
  name: string;
}

export interface Conversation {
  phone_number: string;
  name: string | null;
  message_count: number;
  unread_count: number;
  last_message_at: string;
  last_message: string;
}

export interface SendRequest {
  phone: string;
  text: string;
  sim?: number;
}

export interface WebhookPayload {
  event: string;
  payload: {
    phoneNumber: string;
    message: string;
    receivedAt: string;
    simNumber: number;
  };
  deviceId: string;
  id: string;
  webhookId: string;
}

export interface ListMessagesParams {
  direction?: Direction;
  unread?: boolean;
  phone?: string;
  limit?: number;
  offset?: number;
}

export interface HealthResponse {
  status: "ok";
  unread_count: number;
  total_messages: number;
}

export interface ContactRequest {
  phone: string;
  name: string;
}

export interface SearchResult {
  messages: Message[];
  total: number;
}
