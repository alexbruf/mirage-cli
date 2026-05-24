const URL_SAFE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function generate(size: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let result = "";
  for (let i = 0; i < size; i++) {
    result += URL_SAFE_ALPHABET[bytes[i]! & 63];
  }
  return result;
}

/** 21-char nanoid-style ID for entities (devices, messages, webhooks). */
export function newId(): string {
  return generate(21);
}

/** 32-char secure token for device auth. */
export function newToken(): string {
  return generate(32);
}

/** 6-char uppercase alphanumeric login (for device registration). */
export function newLogin(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i]! % 36];
  }
  return result;
}

/** Generate a random password (16 chars, URL-safe). */
export function newPassword(): string {
  return generate(16);
}
