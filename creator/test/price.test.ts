import { expect, it } from "vitest";
import { priceNightToStar } from "../src/price";

it("converts NIGHT strings to STAR", () => {
  expect(priceNightToStar("1")).toBe(1_000_000n);
  expect(priceNightToStar("0.5")).toBe(500_000n);
  expect(priceNightToStar("0.000001")).toBe(1n);
  expect(() => priceNightToStar("0")).toThrow(/positive/);
  expect(() => priceNightToStar("1.1234567")).toThrow(/6 decimals/);
  expect(() => priceNightToStar("abc")).toThrow();
});
