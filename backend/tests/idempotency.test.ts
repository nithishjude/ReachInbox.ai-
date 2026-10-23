import { describe, expect, it } from "vitest";
import { claimForSending, markSent } from "../src/db/emails.repo";
import { seedCampaign, statusOf } from "./fixtures";

describe("idempotent claim (no email is sent twice)", () => {
  it("lets exactly one of 20 concurrent workers claim an email", async () => {
    const { emailIds } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimForSending(emailIds[0])));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await statusOf(emailIds[0])).toBe("sending");
  });

  it("never re-claims an email that was already sent", async () => {
    const { emailIds } = await seedCampaign({ count: 1, hourlyLimit: 10 });
    expect(await claimForSending(emailIds[0])).not.toBeNull();
    await markSent(emailIds[0], "<id@test>", null, "test-worker");
    expect(await claimForSending(emailIds[0])).toBeNull();
    expect(await statusOf(emailIds[0])).toBe("sent");
  });
});
