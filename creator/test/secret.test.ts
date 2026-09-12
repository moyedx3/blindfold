import { beforeEach, describe, expect, it } from "vitest";
import { exportSecretFile, importSecretFile, loadOrCreateSecret } from "../src/secret";

function installStorageShim(): void {
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
}

beforeEach(() => { installStorageShim(); localStorage.clear(); });

describe("creator secret", () => {
  it("creates once and reuses", () => {
    const first = loadOrCreateSecret();
    const second = loadOrCreateSecret();
    expect(first).toHaveLength(32);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("export/import round-trips and replaces the stored secret", () => {
    const first = loadOrCreateSecret();
    const file = exportSecretFile(first);
    localStorage.clear();
    const second = importSecretFile(file);
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    expect(Buffer.from(loadOrCreateSecret()).equals(Buffer.from(first))).toBe(true);
    expect(JSON.parse(file).v).toBe("blindfold-creator-secret-1");
  });

  it("rejects a foreign file", () => {
    expect(() => importSecretFile('{"v":"x"}')).toThrow(/not a blindfold/);
  });
});
