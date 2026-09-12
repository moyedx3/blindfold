import * as qvl from "@phala/dcap-qvl";
import { fromHex } from "./bytes";

export type VerifiedQuote = {
  status: string;
  reportData: Uint8Array;
  rtmr3: Uint8Array;
  raw: unknown;
};

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike {
  return value !== null && typeof value === "object" ? (value as RecordLike) : {};
}

function bytes(value: unknown, label: string): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (typeof value === "string" && /^(?:0x)?[0-9a-fA-F]+$/.test(value)) {
    return fromHex(value.replace(/^0x/, ""));
  }
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return new Uint8Array(value);
  }
  throw new Error(`QVL report is missing ${label}`);
}

function field(report: RecordLike, names: string[], label: string): Uint8Array {
  for (const name of names) {
    if (name in report) return bytes(report[name], label);
  }
  throw new Error(`QVL report is missing ${label}`);
}

const TD_FIELD_NAMES = ["report_data", "reportData", "rt_mr3", "rtmr3", "rtMr3"];

function hasTdFields(record: RecordLike): boolean {
  return TD_FIELD_NAMES.some((name) => name in record);
}

// @phala/dcap-qvl wraps the parsed quote as { report: { type, data } }. A TDX 1.0
// body (`td10`) carries rtMr3/reportData directly; a TDX 1.5 body (`td15`, what
// current Phala CVMs produce) nests the same fields under `base`. SGX enclave
// reports have no RTMRs and are refused outright.
function tdReportBody(report: RecordLike): RecordLike {
  if (report.type === "sgx") throw new Error("QVL report is an SGX enclave report, not a TDX quote");
  if (hasTdFields(report)) return report;
  const data = asRecord(report.data);
  if (hasTdFields(data)) return data;
  const base = asRecord(data.base);
  if (hasTdFields(base)) return base;
  throw new Error("QVL report is missing RTMR3");
}

export function normalizeVerifiedQuote(result: unknown): VerifiedQuote {
  const root = asRecord(result);
  const body = tdReportBody(asRecord(root.report));
  return {
    status: typeof root.status === "string" ? root.status : "",
    reportData: field(body, ["report_data", "reportData"], "report_data"),
    rtmr3: field(body, ["rt_mr3", "rtmr3", "rtMr3"], "RTMR3"),
    raw: result,
  };
}

function pccsUrl(): string | undefined {
  const configured = import.meta.env.VITE_PCCS_URL as string | undefined;
  if (!configured) return undefined;
  return configured.endsWith("/") ? configured : `${configured}/`;
}

// The only way to verify a quote. There is deliberately no page-global or
// environment override here: anything that could replace this path in a built
// bundle would let an injected script "verify" a fabricated quote and receive
// the sealed content key.
export async function verifyQuote(quoteHex: string): Promise<VerifiedQuote> {
  const result = await qvl.getCollateralAndVerify(fromHex(quoteHex), pccsUrl());
  return normalizeVerifiedQuote(result);
}
