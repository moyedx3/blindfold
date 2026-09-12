import { describe, expect, it } from "vitest";
import { FakeBlindfoldClient } from "@blindfold/midnight-web";
import { sha256, fromHex } from "../src/bytes";
import { commitFor, escrowForDrops, registerDrop, suggestDropId } from "../src/chain";

const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const output = new Uint8Array(a.length + b.length);
  output.set(a, 0);
  output.set(b, a.length);
  return output;
};

describe("creator chain ops", () => {
  it("commitFor is sha256(K_drop || h_content)", async () => {
    const key = new Uint8Array(32).fill(1);
    const hContent = "cd".repeat(32);
    const expected = await sha256(concatBytes(key, fromHex(hContent)));
    expect(await commitFor(key, hContent)).toEqual(expected);
  });

  it("suggestDropId is max+1 or 1", async () => {
    const client = new FakeBlindfoldClient({ drops: new Map([[4n, 1n], [9n, 1n]]) });
    expect(suggestDropId(await client.ledger())).toBe(10);
    expect(suggestDropId(await new FakeBlindfoldClient().ledger())).toBe(1);
  });

  it("registerDrop calls createDrop with the commitment", async () => {
    const client = new FakeBlindfoldClient();
    const key = new Uint8Array(32).fill(2);
    const hContent = "ab".repeat(32);
    await registerDrop(client, { dropId: 7, priceStar: 5n, kDrop: key, hContent });
    expect(client.calls).toEqual([{ method: "createDrop", dropId: 7n, price: 5n }]);
    const view = await client.ledger();
    expect(view.kCommit.get(7n)).toEqual(await sha256(concatBytes(key, fromHex(hContent))));
  });

  it("escrowForDrops lists only the given drops", async () => {
    const client = new FakeBlindfoldClient({ drops: new Map([[1n, 5n], [2n, 5n]]) }, undefined, { privateBalance: 11n });
    await client.purchase(1n, new Uint8Array(32), 5n);
    await client.purchase(2n, new Uint8Array(32), 6n);
    expect(escrowForDrops(await client.ledger(), [2])).toEqual([{ index: 1n, dropId: 2n, valueStar: 6n }]);
  });
});
