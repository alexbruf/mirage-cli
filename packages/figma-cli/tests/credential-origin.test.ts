import { afterEach, expect, test, mock } from "bun:test";
import { FigmaClient } from "../src/client.ts";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
for (const baseUrl of ["https://attacker.example", "http://api.figma.com", "https://api.figma.com.attacker.example", "https://user:pass@api.figma.com", "https://api.figma.com?redirect=evil", "https://api.figma.com/v1"]) {
  test(`rejects credential destination ${baseUrl}`, () => {
    expect(() => new FigmaClient({token: "FAKE_TEST_TOKEN", scheme: "x-figma-token", baseUrl})).toThrow(/origin/);
  });
}
for (const scheme of ["bearer", "x-figma-token"] as const) {
  test(`authenticated ${scheme} requests refuse redirects`, async () => {
    const fetchMock = mock(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get(scheme === "bearer" ? "Authorization" : "X-Figma-Token")).toContain("FAKE_TEST_TOKEN");
      return Response.json({id: "test"});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await new FigmaClient({token: "FAKE_TEST_TOKEN", scheme}).get<{id: string}>("/v1/me")).toEqual({id: "test"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
}
