import { beforeEach, expect, it } from "vitest";
import { listDrops, rememberDrop } from "../src/drops";

beforeEach(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() { return map.size; },
    } as Storage,
  });
  localStorage.clear();
});

it("remembers drops per contract, sorted by id and de-duplicated", () => {
  const contractAddress = "ab".repeat(32);
  rememberDrop({ dropId: 1, title: "a", priceStar: "5", contractAddress, hContent: "cd".repeat(32) });
  rememberDrop({ dropId: 2, title: "b", priceStar: "6", contractAddress, hContent: "ef".repeat(32) });
  rememberDrop({ dropId: 1, title: "a2", priceStar: "5", contractAddress, hContent: "cd".repeat(32) });

  expect(listDrops(contractAddress).map((drop) => [drop.dropId, drop.title])).toEqual([[1, "a2"], [2, "b"]]);
  expect(listDrops("00".repeat(32))).toEqual([]);
});
