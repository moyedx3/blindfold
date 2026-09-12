import { beforeEach, describe, expect, it } from "vitest";
import { CREATOR_SECRET_STORAGE_KEY, CreatorSecretConflictError, exportSecretFile, importSecretFile, loadOrCreateSecret } from "../src/secret";

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

  it("refuses to replace a different stored secret unless told to", () => {
    const current = loadOrCreateSecret();
    const other = exportSecretFile(new Uint8Array(32).fill(7));
    expect(() => importSecretFile(other)).toThrow(CreatorSecretConflictError);
    expect(Buffer.from(loadOrCreateSecret()).equals(Buffer.from(current))).toBe(true);
    const replaced = importSecretFile(other, undefined, { replace: true });
    expect(Buffer.from(replaced).equals(Buffer.from(new Uint8Array(32).fill(7)))).toBe(true);
  });

  it("re-importing the currently stored secret is not a conflict", () => {
    const current = loadOrCreateSecret();
    expect(() => importSecretFile(exportSecretFile(current))).not.toThrow();
  });

  it("does not regenerate over a corrupted stored value", () => {
    localStorage.setItem(CREATOR_SECRET_STORAGE_KEY, "not-hex");
    expect(() => loadOrCreateSecret()).toThrow(/corrupted/);
    expect(localStorage.getItem(CREATOR_SECRET_STORAGE_KEY)).toBe("not-hex");
  });
});
