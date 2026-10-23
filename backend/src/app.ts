import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { authRouter } from "./api/auth.routes";
import { campaignsRouter } from "./api/campaigns.routes";
import { emailsRouter, metaRouter } from "./api/schedule.routes";
import { optionalAuth, requireAdmin, requireAuth } from "./auth/session";
import { env } from "./config/env";
import { pool } from "./db/client";
import { redis } from "./lib/redis";
import { emailQueue } from "./queue/queue";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: "5mb" })); // room for ~10k recipients
  app.use(cookieParser());
  app.use(optionalAuth);

  app.get("/api/health", async (_req, res) => {
    const [db, rd] = await Promise.allSettled([pool.query("SELECT 1"), redis.ping()]);
    const ok = db.status === "fulfilled" && rd.status === "fulfilled";
    res.status(ok ? 200 : 503).json({ ok, db: db.status, redis: rd.status });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/emails", requireAuth, emailsRouter);
  app.use("/api/campaigns", requireAuth, campaignsRouter);
  app.use("/api", requireAuth, metaRouter);

  // Live BullMQ dashboard (waiting / delayed / active / completed / failed jobs).
  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: boardAdapter });
  app.use("/admin/queues", requireAdmin, boardAdapter.getRouter());

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api] unhandled error", err);
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}
