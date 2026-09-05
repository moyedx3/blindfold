import { z } from "zod";
import { bytesToArrayBuffer } from "./bytes";

const SHA256_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

export type ApiStage = "contract" | "attest" | "catalog" | "bucket" | "provision";

export class IndexerApiError extends Error {
  constructor(
    readonly stage: ApiStage,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IndexerApiError";
  }
}

export type ContractInfo = z.infer<typeof ContractInfoSchema>;
export type Attestation = z.infer<typeof AttestationSchema>;
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

const ContractInfoSchema = z.object({
  network: z.string().min(1),
  contract_address: z.string().regex(SHA256_HEX_PATTERN),
});

const AttestationSchema = z.object({
  quote_hex: z.string().min(1),
  provisioning_pubkey_hex: z.string().regex(SHA256_HEX_PATTERN),
});

const CatalogEntrySchema = z.object({
  drop_id: z.number().int().nonnegative(),
  price_star: z.string().regex(/^\d+$/),
  h_content: z.string().regex(SHA256_HEX_PATTERN),
  title: z.string().max(200),
});

const ProvisionResponseSchema = z.object({
  ok: z.literal(true),
  drop_id: z.number().int().nonnegative(),
});

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return `${response.status} ${response.statusText}`.trim();
    try {
      const body = JSON.parse(text) as { message?: unknown; error?: unknown };
      if (typeof body.message === "string") return body.message;
      if (typeof body.error === "string") return body.error;
    } catch {
      // Fall through to the raw response text.
    }
    return text;
  } catch {
    return `${response.status} ${response.statusText}`.trim();
  }
}

async function request(stage: ApiStage, url: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new IndexerApiError(stage, await responseMessage(response), response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof IndexerApiError) throw error;
    throw new IndexerApiError(stage, `indexer unreachable at ${new URL(url).origin}`);
  }
}

async function fetchParsedJson<T>(stage: ApiStage, url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await request(stage, url);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new IndexerApiError(stage, "indexer returned invalid JSON", response.status);
  }
  try {
    return schema.parse(value);
  } catch {
    throw new IndexerApiError(stage, "indexer returned an unexpected response", response.status);
  }
}

export function fetchContract(indexerUrl: string): Promise<ContractInfo> {
  return fetchParsedJson("contract", joinUrl(indexerUrl, "/contract"), ContractInfoSchema);
}

export function fetchAttestation(indexerUrl: string): Promise<Attestation> {
  return fetchParsedJson("attest", joinUrl(indexerUrl, "/attest"), AttestationSchema);
}

export function fetchCatalog(indexerUrl: string): Promise<CatalogEntry[]> {
  return fetchParsedJson("catalog", joinUrl(indexerUrl, "/catalog"), z.array(CatalogEntrySchema));
}

export async function uploadContentBlob(indexerUrl: string, hContent: string, blob: Uint8Array): Promise<void> {
  if (!SHA256_HEX_PATTERN.test(hContent)) throw new Error("h_content must be a SHA-256 hex value");
  if (blob.length > 50 * 1024 * 1024) throw new Error("content blob must be at most 50 MiB");
  await request("bucket", joinUrl(indexerUrl, `/bucket/${hContent.toLowerCase()}`), {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: bytesToArrayBuffer(blob),
  });
}

export async function postProvision(indexerUrl: string, sealed: Uint8Array): Promise<{ ok: true; drop_id: number }> {
  const response = await request("provision", joinUrl(indexerUrl, "/provision"), {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytesToArrayBuffer(sealed),
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new IndexerApiError("provision", "indexer returned invalid JSON", response.status);
  }
  try {
    return ProvisionResponseSchema.parse(value);
  } catch {
    throw new IndexerApiError("provision", "indexer returned an unexpected response", response.status);
  }
}
