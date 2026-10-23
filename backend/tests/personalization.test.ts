import { describe, expect, it } from "vitest";
import { getCampaign } from "../src/db/campaigns.repo";
import { pool } from "../src/db/client";
import { createCampaign, markSent, claimForSending } from "../src/db/emails.repo";
import { leadVars, renderTemplate, toVarKey } from "../src/lib/template";
import { seedCampaign, seedUserAndSender } from "./fixtures";

describe("template rendering", () => {
  it("normalises CSV headers to variable keys", () => {
    expect(toVarKey(" First Name ")).toBe("first_name");
    expect(toVarKey("Company-Name")).toBe("company_name");
  });

  it("fills variables, derives first_name and applies fallbacks", () => {
    const vars = leadVars("ava@acme.com", { Name: "Ava Thompson", Company: "Acme" });
    expect(renderTemplate("Hi {{first_name}} at {{ company }} ({{email}})", vars)).toBe("Hi Ava at Acme (ava@acme.com)");
    expect(renderTemplate("Hi {{title | there}}", vars)).toBe("Hi there");
    expect(renderTemplate("Hi {{missing}}!", vars)).toBe("Hi !");
  });

  it("escapes lead data inside HTML bodies", () => {
    const vars = leadVars("x@y.com", { name: '<script>alert("x")</script>' });
    expect(renderTemplate("<p>Hi {{name}}</p>", vars, { html: true })).toBe("<p>Hi &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  });
});

describe("personalised campaigns", () => {
  it("stores a rendered subject and body per recipient", async () => {
    const { userId, senderId } = await seedUserAndSender();
    const { emails } = await createCampaign({
      userId,
      senderId,
      subject: "Quick question, {{first_name}}",
      body: "<p>Hi {{first_name | there}}, loved what {{company}} is doing.</p>",
      startAt: new Date(),
      delayMs: 0,
      hourlyLimit: 10,
      recipients: [{ email: "ava@acme.com", fields: { name: "Ava Thompson", company: "Acme" } }, { email: "ben@globex.io" }],
    });
    const { rows } = await pool.query(`SELECT recipient, subject, body FROM emails WHERE id = ANY($1::uuid[]) ORDER BY seq`, [
      emails.map((e) => e.id),
    ]);
    expect(rows[0]).toMatchObject({ subject: "Quick question, Ava", body: "<p>Hi Ava, loved what Acme is doing.</p>" });
    expect(rows[1]).toMatchObject({ subject: "Quick question,", body: "<p>Hi there, loved what  is doing.</p>" });
  });
});

describe("campaign progress", () => {
  it("counts each status and the sends in the current hour", async () => {
    const { userId, campaignId, emailIds } = await seedCampaign({ count: 4, hourlyLimit: 10 });
    await claimForSending(emailIds[0]);
    await markSent(emailIds[0], "<a@test>", null, "w1");
    await pool.query("UPDATE emails SET status = 'rate_limited', next_attempt_at = now() + interval '1 hour' WHERE id = $1", [emailIds[1]]);
    await pool.query("UPDATE emails SET status = 'failed' WHERE id = $1", [emailIds[2]]);

    const c = await getCampaign(userId, campaignId);
    expect(c?.total).toBe(4);
    expect(c?.counts).toEqual({ scheduled: 1, rate_limited: 1, sending: 0, sent: 1, failed: 1 });
    expect(c?.sent_this_hour).toBe(1);
    expect(c?.resumes_at).not.toBeNull();
  });
});
