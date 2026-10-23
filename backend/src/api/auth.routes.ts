import crypto from "crypto";
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { pool } from "../db/client";
import { clearSession, isAdmin, issueSession, SessionUser } from "../auth/session";

const STATE_COOKIE = "ri_oauth_state";

const googleClient = () => new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);

export const authRouter = Router();

/** Step 1: redirect the browser to Google's consent screen. */
authRouter.get("/google", (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    res.status(500).send("Google OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60_000 });
  const url = googleClient().generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });
  res.redirect(url);
});

/** Step 2: Google redirects back with ?code; exchange it, verify the ID token, start a session. */
authRouter.get("/google/callback", async (req, res) => {
  const fail = (reason: string) => res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(reason)}`);
  try {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return fail(error);
    if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) return fail("invalid_state");
    res.clearCookie(STATE_COOKIE);

    const client = googleClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return fail("missing_id_token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) return fail("invalid_profile");

    const { rows: [user] } = await pool.query<{ id: string; email: string; name: string; avatar_url: string | null }>(
      `INSERT INTO users (google_sub, email, name, avatar_url) VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_sub) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, updated_at = now()
       RETURNING id, email, name, avatar_url`,
      [p.sub, p.email, p.name ?? p.email, p.picture ?? null],
    );
    const session: SessionUser = { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url };
    issueSession(res, session);
    res.redirect(`${env.FRONTEND_URL}/`);
  } catch (err) {
    console.error("[auth] callback failed", err);
    fail("oauth_failed");
  }
});

authRouter.get("/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: { ...req.user, isAdmin: isAdmin(req.user) } });
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
