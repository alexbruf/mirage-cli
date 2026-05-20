import { endpointCommand } from "../command-builder.ts";
import { group } from "../framework/runtime.ts";

export const accountLimitsCmd = endpointCommand({
  path: "/subscription-info/limits-and-usage",
  name: "limits",
  summary: "Subscription limits and unit consumption for the current period.",
  single: true,
  rowsKey: "limits_and_usage",
});

export const accountGroup = group({
  name: "account",
  description: "Account info: subscription limits and units consumed.",
  commands: [accountLimitsCmd],
});
