import { fromHex, toHex } from "./bytes";

export const CREATOR_SECRET_STORAGE_KEY = "blindfold-creator-secret";
const SECRET_FILE_VERSION = "blindfold-creator-secret-1";
const SECRET_HEX = /^[0-9a-fA-F]{64}$/;

// The creator secret is the withdraw authority for every drop registered with
// it (the contract checks dropOwner == creatorPk(secret)). Nothing in this file
// may replace a stored secret silently.
export class CreatorSecretConflictError extends Error {
  constructor() {
    super("a different creator secret is already stored in this browser");
    this.name = "CreatorSecretConflictError";
  }
}

function store(storage?: Storage): Storage {
  return storage ?? localStorage;
}

function assertSecret(secret: Uint8Array): void {
  if (secret.length !== 32) throw new Error("creator secret must be 32 bytes");
}

export function loadOrCreateSecret(storage?: Storage): Uint8Array {
  const target = store(storage);
  const existing = target.getItem(CREATOR_SECRET_STORAGE_KEY);
  if (existing !== null) {
    if (SECRET_HEX.test(existing)) return fromHex(existing);
    throw new Error("stored creator secret is corrupted; import your creator secret backup instead of generating a new one");
  }

  const secret = crypto.getRandomValues(new Uint8Array(32));
  target.setItem(CREATOR_SECRET_STORAGE_KEY, toHex(secret));
  return secret;
}

export function exportSecretFile(secret: Uint8Array): string {
  assertSecret(secret);
  return JSON.stringify({ v: SECRET_FILE_VERSION, secret_hex: toHex(secret) }, null, 2);
}

export function importSecretFile(json: string, storage?: Storage, options: { replace?: boolean } = {}): Uint8Array {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("not a blindfold creator secret file");
  }

  const object = value !== null && typeof value === "object" ? (value as { v?: unknown; secret_hex?: unknown }) : {};
  if (object.v !== SECRET_FILE_VERSION || typeof object.secret_hex !== "string" || !SECRET_HEX.test(object.secret_hex)) {
    throw new Error("not a blindfold creator secret file");
  }

  const secretHex = object.secret_hex.toLowerCase();
  const target = store(storage);
  const existing = target.getItem(CREATOR_SECRET_STORAGE_KEY);
  if (existing !== null && existing.toLowerCase() !== secretHex && !options.replace) {
    throw new CreatorSecretConflictError();
  }
  target.setItem(CREATOR_SECRET_STORAGE_KEY, secretHex);
  return fromHex(secretHex);
}
