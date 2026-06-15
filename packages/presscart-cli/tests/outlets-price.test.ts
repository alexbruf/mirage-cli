import { describe, expect, test } from "bun:test";
import { outletPriceUsd } from "../src/commands/outlets.ts";

describe("outletPriceUsd (BLU-641)", () => {
  test("reads unit_amount (whole USD) first", () => {
    expect(outletPriceUsd({ unit_amount: 250, price: 999 })).toBe(250);
  });

  test("accepts numeric strings and falls back across field names", () => {
    expect(outletPriceUsd({ price: "120" })).toBe(120);
    expect(outletPriceUsd({ amount: 75 })).toBe(75);
    expect(outletPriceUsd({ cost: "49.5" })).toBe(49.5);
  });

  test("returns undefined when no numeric price is present", () => {
    expect(outletPriceUsd({ name: "Example Outlet" })).toBeUndefined();
    expect(outletPriceUsd({ unit_amount: "free" })).toBeUndefined();
  });
});
