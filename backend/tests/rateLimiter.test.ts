import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { HOUR_MS, reserveSendSlot, type ReserveParams } from "../src/rateLimiter/hourlyLimiter";

const ids = () => ({ senderId: randomUUID(), campaignId: randomUUID() });

describe("hourly rate limiter (Redis Lua)", () => {
  it("allows exactly N sends per hour even with 50 concurrent callers", async () => {
    const base: ReserveParams = { ...ids(), campaignHourlyLimit: 5, minGapMs: 0 };
    const results = await Promise.all(Array.from({ length: 50 }, () => reserveSendSlot(base)));

    const reserved = results.filter((r) => r.kind === "reserved");
    const limited = results.filter((r) => r.kind === "limited");
    expect(reserved).toHaveLength(5);
    expect(limited).toHaveLength(45);

    // Over-limit jobs are rescheduled into the next hour window, never dropped.
    const nextWindow = (Math.floor(reserved[0].now / HOUR_MS) + 1) * HOUR_MS;
    for (const r of limited) {
      expect(r).toMatchObject({ kind: "limited", scope: "campaign" });
      if (r.kind === "limited") expect(r.retryAt).toBe(nextWindow);
    }
  });

  it("enforces the per-sender limit across different campaigns", async () => {
    const senderId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => reserveSendSlot({ senderId, campaignId: randomUUID(), campaignHourlyLimit: 100, senderHourlyLimit: 4, minGapMs: 0 })),
    );
    expect(results.filter((r) => r.kind === "reserved")).toHaveLength(4);
    expect(results.filter((r) => r.kind === "limited").every((r) => r.kind === "limited" && r.scope === "sender")).toBe(true);
  });

  it("spaces sends from one sender by the minimum gap, in order", async () => {
    const base: ReserveParams = { ...ids(), campaignHourlyLimit: 100, minGapMs: 2000 };
    const slots: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await reserveSendSlot(base);
      if (r.kind === "reserved") slots.push(r.at);
    }
    expect(slots).toHaveLength(5);
    for (let i = 1; i < slots.length; i++) expect(slots[i] - slots[i - 1]).toBe(2000);
  });
});
