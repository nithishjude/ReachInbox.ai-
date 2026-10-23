import { env } from "../config/env";
import { redis } from "../lib/redis";

export const HOUR_MS = 3_600_000;

/**
 * Atomic send-slot reservation, executed inside Redis so every worker process / instance
 * sees the same counters (nothing is kept in memory).
 *
 * Time comes from Redis' own clock (TIME), so workers with skewed clocks still agree on
 * which hour window "now" belongs to.
 *
 * Algorithm:
 *   slot   = max(now, nextFreeSlot[sender])        -- min-gap between sends of one sender
 *   window = floor(slot / 1h)                      -- fixed clock-hour windows
 *   if senderCount[window]   >= senderLimit   -> LIMITED, retry at next window
 *   if campaignCount[window] >= campaignLimit -> LIMITED, retry at next window
 *   else reserve: count++ for both, nextFreeSlot[sender] = slot + gap
 *
 * Reserving a *future* slot (instead of telling the caller "try again later") means jobs that
 * contend for the same sender are spread out deterministically, in arrival order, with no
 * thundering herd of retries.
 *
 * Returns { code, at, now }:
 *   code 0 = reserved, send at `at` (== now when the sender is idle)
 *   code 1 = sender hourly limit reached, `at` = start of next window
 *   code 2 = campaign hourly limit reached, `at` = start of next window
 */
const RESERVE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local senderPrefix, campaignPrefix, gapKey = ARGV[1], ARGV[2], ARGV[3]
local senderLimit, campaignLimit, gap = tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])
local hourMs = 3600000

local slot = now
local nextFree = tonumber(redis.call('GET', gapKey) or '0')
if nextFree > slot then slot = nextFree end

local window = math.floor(slot / hourMs)
local nextWindowStart = (window + 1) * hourMs
local senderKey = senderPrefix .. ':' .. window
local campaignKey = campaignPrefix .. ':' .. window

if tonumber(redis.call('GET', senderKey) or '0') >= senderLimit then
  return {1, nextWindowStart, now}
end
if tonumber(redis.call('GET', campaignKey) or '0') >= campaignLimit then
  return {2, nextWindowStart, now}
end

redis.call('INCR', senderKey)
redis.call('PEXPIRE', senderKey, 3 * hourMs)
redis.call('INCR', campaignKey)
redis.call('PEXPIRE', campaignKey, 3 * hourMs)
if gap > 0 then
  redis.call('SET', gapKey, slot + gap, 'PX', gap + 60000)
end
return {0, slot, now}
`;

export type ReserveResult =
  | { kind: "reserved"; at: number; now: number }
  | { kind: "limited"; scope: "sender" | "campaign"; retryAt: number; now: number };

export async function reserveSendSlot(params: {
  senderId: string;
  campaignId: string;
  campaignHourlyLimit: number;
}): Promise<ReserveResult> {
  const [code, at, now] = (await redis.eval(
    RESERVE_SCRIPT,
    0,
    `rl:sender:${params.senderId}`,
    `rl:campaign:${params.campaignId}`,
    `gap:sender:${params.senderId}`,
    env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    params.campaignHourlyLimit,
    env.MIN_DELAY_BETWEEN_SENDS_MS,
  )) as [number, number, number];

  if (code === 0) return { kind: "reserved", at, now };
  return { kind: "limited", scope: code === 1 ? "sender" : "campaign", retryAt: at, now };
}

/** Current usage, for the dashboard / debugging. */
export async function getSenderUsage(senderId: string): Promise<{ window: number; used: number; limit: number }> {
  const window = Math.floor(Date.now() / HOUR_MS);
  const used = Number((await redis.get(`rl:sender:${senderId}:${window}`)) ?? 0);
  return { window, used, limit: env.MAX_EMAILS_PER_HOUR_PER_SENDER };
}
