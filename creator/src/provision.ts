import sodium from "libsodium-wrappers";
import { parseSha256Hex } from "./content";
import { toHex, utf8Bytes } from "./bytes";

export type ProvisionPayload = {
  drop_id: number;
  price_star: string;
  k_drop: string;
  h_content: string;
  title: string;
};

export function buildProvisionPayload(args: {
  dropId: number;
  priceStar: bigint;
  kDrop: Uint8Array;
  hContent: string;
  title: string;
}): ProvisionPayload {
  if (!Number.isSafeInteger(args.dropId) || args.dropId < 0) {
    throw new Error("drop_id must be a non-negative safe integer");
  }
  if (args.priceStar <= 0n) throw new Error("price_star must be positive");
  if (args.kDrop.length !== 32) throw new Error("k_drop must be 32 bytes");

  parseSha256Hex(args.hContent);
  return {
    drop_id: args.dropId,
    price_star: args.priceStar.toString(),
    k_drop: toHex(args.kDrop),
    h_content: args.hContent.toLowerCase(),
    title: args.title.trim().slice(0, 200),
  };
}

export async function sealProvisionPayload(
  payload: ProvisionPayload,
  enclavePubkey: Uint8Array,
): Promise<Uint8Array> {
  if (enclavePubkey.length !== 32) {
    throw new Error("enclave public key must be 32 bytes");
  }
  await sodium.ready;
  return sodium.crypto_box_seal(utf8Bytes(JSON.stringify(payload)), enclavePubkey);
}
