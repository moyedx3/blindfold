import { describe, expect, it, vi } from "vitest";

const { collateral } = vi.hoisted(() => ({ collateral: vi.fn() }));
vi.mock("@phala/dcap-qvl", () => ({ getCollateralAndVerify: (...args: unknown[]) => collateral(...args) }));

import { normalizeVerifiedQuote, verifyQuote } from "../src/qvl-verifier";

const rtmr3 = new Uint8Array(48).fill(0xab);
const reportData = new Uint8Array(64).fill(0x01);
const td10 = { type: "td10", data: { rtMr3: rtmr3, reportData } };
const td15 = { type: "td15", data: { base: { rtMr3: rtmr3, reportData }, teeTcbSvn2: new Uint8Array(16), mrServiceTd: new Uint8Array(48) } };

describe("normalizeVerifiedQuote", () => {
  it("reads a TDX 1.0 report body", () => {
    const out = normalizeVerifiedQuote({ status: "UpToDate", report: td10 });
    expect(out.status).toBe("UpToDate");
    expect(out.rtmr3).toEqual(rtmr3);
    expect(out.reportData).toEqual(reportData);
  });

  it("reads a TDX 1.5 report body nested under base", () => {
    const out = normalizeVerifiedQuote({ status: "UpToDate", report: td15 });
    expect(out.rtmr3).toEqual(rtmr3);
    expect(out.reportData).toEqual(reportData);
  });

  it("refuses an SGX enclave report", () => {
    expect(() => normalizeVerifiedQuote({ status: "UpToDate", report: { type: "sgx", data: { reportData } } })).toThrow(/SGX/);
  });

  it("fails closed when RTMR3 is absent", () => {
    expect(() => normalizeVerifiedQuote({ status: "UpToDate", report: { type: "td15", data: {} } })).toThrow(/RTMR3/);
  });
});

describe("verifyQuote", () => {
  it("always goes through the QVL library and ignores any page-global override", async () => {
    collateral.mockResolvedValueOnce({ status: "OutOfDate", report: td15 });
    const page = window as unknown as Record<string, unknown>;
    page.blindfoldQuoteVerifier = async () => ({ status: "UpToDate", report: td10 });
    try {
      const out = await verifyQuote("0102");
      expect(collateral).toHaveBeenCalledTimes(1);
      expect(out.status).toBe("OutOfDate");
    } finally {
      delete page.blindfoldQuoteVerifier;
    }
  });
});
