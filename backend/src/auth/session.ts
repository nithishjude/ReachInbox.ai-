import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const SESSION_COOKIE = "ri_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function issueSession(res: Response, user: SessionUser): string {
  const token = jwt.sign(user, env.JWT_SECRET, { expiresIn: SESSION_TTL_SECONDS });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.FRONTEND_URL.startsWith("https://"),
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
  return token;
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
}

function readToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7); // handy for Postman
  return req.cookies?.[SESSION_COOKIE];
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (token) {
    try {
      const { id, email, name, avatarUrl } = jwt.verify(token, env.JWT_SECRET) as SessionUser;
      req.user = { id, email, name, avatarUrl };
    } catch {
      /* invalid/expired token -> anonymous */
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}
