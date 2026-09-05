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

export function normalizeVerifiedQuote(result: unknown): VerifiedQuote {
  const root = asRecord(result);
  const report = asRecord(root.report);
  // @phala/dcap-qvl returns a Report wrapper whose TDX fields live under
  // report.data; accepting both shapes keeps this boundary easy to test.
  const reportData =
    ["report_data", "reportData", "rt_mr3", "rtmr3", "rtMr3"].some((name) => name in report)
      ? report
      : asRecord(report.data);
  return {
    status: typeof root.status === "string" ? root.status : "",
    reportData: field(reportData, ["report_data", "reportData"], "report_data"),
    rtmr3: field(reportData, ["rt_mr3", "rtmr3", "rtMr3"], "RTMR3"),
    raw: result,
  };
}

function pccsUrl(): string | undefined {
  const configured = import.meta.env.VITE_PCCS_URL as string | undefined;
  if (!configured) return undefined;
  return configured.endsWith("/") ? configured : `${configured}/`;
}

export async function verifyQuote(quoteHex: string): Promise<VerifiedQuote> {
  const rawQuote = fromHex(quoteHex);
  const customVerifier = typeof window !== "undefined" ? window.blindfoldQuoteVerifier : undefined;
  if (customVerifier) return normalizeVerifiedQuote(await customVerifier(rawQuote));

  const result = await qvl.getCollateralAndVerify(rawQuote, pccsUrl());
  return normalizeVerifiedQuote(result);
}

declare global {
  interface Window {
    blindfoldQuoteVerifier?: (quote: Uint8Array) => Promise<unknown>;
  }
}
