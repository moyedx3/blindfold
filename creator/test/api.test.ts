import { describe, expect, it, vi } from "vitest";
import { fetchCatalog, fetchContract, IndexerApiError, postProvision } from "../src/api";

describe("creator api", () => {
  it("parses /contract and /catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String((input as { url?: string }).url ?? input);
      if (url.endsWith("/contract")) return new Response(JSON.stringify({ network: "undeployed", contract_address: "ab".repeat(32) }), { headers: { "content-type": "application/json" } });
      if (url.endsWith("/catalog")) return new Response(JSON.stringify([{ drop_id: 1, price_star: "5", title: "t", h_content: "cd".repeat(32) }]), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ error: "commit_mismatch" }), { status: 409, headers: { "content-type": "application/json" } });
    }));

    expect((await fetchContract("http://x")).contract_address).toBe("ab".repeat(32));
    expect((await fetchCatalog("http://x"))[0].price_star).toBe("5");
    await expect(postProvision("http://x", new Uint8Array(3))).rejects.toMatchObject({ stage: "provision", status: 409 });
    await expect(postProvision("http://x", new Uint8Array(3))).rejects.toBeInstanceOf(IndexerApiError);
  });
});
