import { DelayedError, type Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/client";
import { seedCampaign, statusOf } from "./fixtures";

// Real SMTP is replaced by a spy; everything else (Postgres, Redis limiter) is real.
const sendSpy = vi.fn(async (_t: unknown, _s: unknown, email: { id: string }) => ({ messageId: `<${email.id}@test>`, previewUrl: null }));
vi.mock("../src/mail/sendEmail", async (orig) => ({ ...(await orig<object>()), sendEmail: (...a: [unknown, unknown, { id: string }]) => sendSpy(...a) }));
vi.mock("../src/mail/senders", async (orig) => ({
  ...(await orig<object>()),
  getTransport: async () => ({ transport: {}, sender: { email: "sender@test", name: "Sender" } }),
}));

const { processEmailJob } = await import("../src/queue/worker");

/** Minimal stand-in for a BullMQ job, recording reschedules. */
function fakeJob(emailId: string) {
  const job = {
    id: `email-${emailId}`,
    data: { emailId } as { emailId: string; reservedAt?: number },
    opts: { attempts: 3 },
    attemptsMade: 0,
    movedTo: undefined as number | undefined,
    updateData: async (d: { emailId: string; reservedAt?: number }) => void (job.data = d),
    moveToDelayed: async (ts: number) => void (job.movedTo = ts),
  };
  return job;
}
const run = (job: ReturnType<typeof fakeJob>) => processEmailJob(job as unknown as Job, "token");

beforeEach(() => {
  sendSpy.mockClear();
});

describe("email worker", () => {
  it("sends a due email once and marks it sent with the worker id", async () => {
    const { emailIds } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    expect(await run(fakeJob(emailIds[0]))).toMatch(/^sent/);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const { rows } = await pool.query("SELECT status, processed_by, sent_at FROM emails WHERE id = $1", [emailIds[0]]);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].processed_by).toMatch(/:\d+$/);
    expect(rows[0].sent_at).not.toBeNull();
  });

  it("is idempotent: a re-delivered job (e.g. after a restart) does not send again", async () => {
    const { emailIds } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    await run(fakeJob(emailIds[0]));
    expect(await run(fakeJob(emailIds[0]))).toBe("skipped: already sent");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("reschedules over-limit emails into the next hour, in order, instead of failing", async () => {
    const { emailIds } = await seedCampaign({ count: 3, hourlyLimit: 1 });

    await run(fakeJob(emailIds[0])); // uses the only slot this hour
    const second = fakeJob(emailIds[1]);
    const third = fakeJob(emailIds[2]);
    await expect(run(second)).rejects.toBeInstanceOf(DelayedError);
    await expect(run(third)).rejects.toBeInstanceOf(DelayedError);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await statusOf(emailIds[0])).toBe("sent");
    expect(await statusOf(emailIds[1])).toBe("rate_limited");

    const nextHour = (Math.floor(Date.now() / 3_600_000) + 1) * 3_600_000;
    expect(second.movedTo).toBeGreaterThanOrEqual(nextHour);
    expect(third.movedTo!).toBeGreaterThan(second.movedTo!); // original order is preserved
    expect(await statusOf(emailIds[2])).toBe("rate_limited"); // rescheduled, not failed
  });

  it("skips emails that were cancelled (deleted) before their send time", async () => {
    const { emailIds } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    await pool.query("DELETE FROM emails WHERE id = $1", [emailIds[0]]);
    expect(await run(fakeJob(emailIds[0]))).toBe("skipped: email no longer exists");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
