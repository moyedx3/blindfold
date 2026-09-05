import type { BlindfoldClient, LedgerView, TxRef } from "@blindfold/midnight-web";
import { fromHex, sha256 } from "./bytes";

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** The commitment binds both the key and the exact ciphertext identified by h_content. */
export function commitFor(kDrop: Uint8Array, hContent: string): Promise<Uint8Array> {
  const contentHash = fromHex(hContent);
  if (kDrop.length !== 32) throw new Error("k_drop must be 32 bytes");
  if (contentHash.length !== 32) throw new Error("h_content must be a 32-byte sha256 hex value");
  return sha256(concat([kDrop, contentHash]));
}

export function suggestDropId(view: LedgerView): number {
  let maximum = 0n;
  for (const id of view.drops.keys()) if (id > maximum) maximum = id;
  const next = maximum + 1n;
  if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("next drop id exceeds JavaScript safe integer range");
  return Number(next);
}

export async function registerDrop(
  client: BlindfoldClient,
  args: { dropId: number; priceStar: bigint; kDrop: Uint8Array; hContent: string },
): Promise<TxRef> {
  if (!Number.isSafeInteger(args.dropId) || args.dropId < 0) throw new Error("drop id must be a non-negative safe integer");
  if (args.priceStar <= 0n) throw new Error("price must be positive");
  return client.createDrop(BigInt(args.dropId), args.priceStar, await commitFor(args.kDrop, args.hContent));
}

export function escrowForDrops(
  view: LedgerView,
  dropIds: number[],
): Array<{ index: bigint; dropId: bigint; valueStar: bigint }> {
  const selected = new Set(dropIds.map((id) => BigInt(id)));
  const result: Array<{ index: bigint; dropId: bigint; valueStar: bigint }> = [];

  for (const [index, coin] of view.escrow) {
    const dropId = view.purchaseDrop.get(index);
    if (dropId !== undefined && selected.has(dropId)) {
      result.push({ index, dropId, valueStar: coin.value });
    }
  }

  return result.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
}
