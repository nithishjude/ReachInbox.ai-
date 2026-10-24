import { describe, expect, it } from "vitest";
import { friendlyError, isOverdue } from "./emailStatus";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("isOverdue", () => {
  it("flags pending emails more than a minute past their time", () => {
    expect(isOverdue({ status: "scheduled", next_attempt_at: minutesAgo(3) })).toBe(true);
    expect(isOverdue({ status: "sending", next_attempt_at: minutesAgo(5) })).toBe(true);
  });

  it("gives a minute of grace and ignores future, sent and rate-limited emails", () => {
    expect(isOverdue({ status: "scheduled", next_attempt_at: minutesAgo(0.5) })).toBe(false);
    expect(isOverdue({ status: "scheduled", next_attempt_at: minutesAgo(-10) })).toBe(false);
    expect(isOverdue({ status: "sent", next_attempt_at: minutesAgo(30) })).toBe(false);
    expect(isOverdue({ status: "rate_limited", next_attempt_at: minutesAgo(30) })).toBe(false);
  });
});

describe("friendlyError", () => {
  it("explains network failures", () => {
    expect(friendlyError("Connection timeout")).toBe("Couldn't reach the mail server");
    expect(friendlyError("connect ETIMEDOUT 95.216.108.161:587")).toBe("Couldn't reach the mail server");
  });

  it("explains login and rejection errors and keeps unknown ones as-is", () => {
    expect(friendlyError("Invalid login: 535 Authentication failed")).toBe("The mail server rejected the sender's login");
    expect(friendlyError("550 Mailbox unavailable, recipient rejected")).toBe("The mail server rejected this email");
    expect(friendlyError("Something odd")).toBe("Something odd");
  });
});
