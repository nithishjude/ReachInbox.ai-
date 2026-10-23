import { Router } from "express";
import { z } from "zod";
import { getCampaign, listCampaigns } from "../db/campaigns.repo";
import { pool } from "../db/client";
import { asyncHandler } from "./asyncHandler";

export const campaignsRouter = Router();

const listQuery = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/campaigns: every batch the user scheduled, with live progress counts. */
campaignsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const { items, total } = await listCampaigns({
      userId: req.user!.id,
      search: q.search || undefined,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

/** GET /api/campaigns/:id: progress plus the campaign's emails in send order. */
campaignsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const campaign = await getCampaign(req.user!.id, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const { rows: emails } = await pool.query(
      `SELECT e.id, e.recipient, e.subject, e.body, e.status, e.scheduled_at, e.next_attempt_at, e.sent_at,
              e.error, e.preview_url, s.name AS sender_name, s.email AS sender_email
       FROM emails e JOIN senders s ON s.id = e.sender_id
       WHERE e.campaign_id = $1 ORDER BY e.seq LIMIT 1000`,
      [campaign.id],
    );
    res.json({ campaign, emails });
  }),
);
