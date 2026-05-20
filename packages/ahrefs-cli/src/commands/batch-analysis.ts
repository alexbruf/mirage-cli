import { endpointCommand } from "../command-builder.ts";

// The Ahrefs `targets` field expects an array of {url, mode, protocol} objects.
// The CLI accepts comma-separated targets ("ahrefs.com,semrush.com") and
// wraps each into the object shape. To override per-target, pass a JSON array
// directly with --targets '[...]'.
export const batchAnalysisCmd = endpointCommand({
  path: "/batch-analysis/batch-analysis",
  method: "post",
  name: "batch-analysis",
  rowsKey: "targets",
  defaultSelect: "url,domain_rating,url_rating,backlinks,refdomains",
  bodyTransforms: {
    targets: (raw: unknown) => {
      if (Array.isArray(raw)) {
        return raw.map((t) =>
          typeof t === "string"
            ? { url: t.trim(), mode: "domain", protocol: "both" }
            : t,
        );
      }
      if (typeof raw === "string") {
        const s = raw.trim();
        if (s.startsWith("[")) return JSON.parse(s);
        return s
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => ({ url: t, mode: "domain", protocol: "both" }));
      }
      return raw;
    },
  },
});
