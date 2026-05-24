export function messageId(
  phone: string,
  text: string,
  timestamp: string,
  direction: string,
): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${phone}|${text}|${timestamp}|${direction}`);
  return hasher.digest("hex").slice(0, 32);
}
