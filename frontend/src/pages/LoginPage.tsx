import { AlertCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { GOOGLE_LOGIN_URL } from "../lib/api";

const errorMessages: Record<string, string> = {
  access_denied: "Google sign-in was cancelled.",
  invalid_state: "Your sign-in session expired. Please try again.",
  session_expired: "Your session expired. Please log in again.",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const oauthError = params.get("error");
  const message = oauthError ? (errorMessages[oauthError] ?? "Sign-in failed. Please try again.") : null;

  // Google is the only sign-in method (real OAuth 2.0); there is deliberately no email/password form.
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[620px] rounded-2xl border border-line bg-surface px-6 py-14 sm:px-[72px]">
        <h1 className="text-center text-[44px] font-semibold leading-none">Login</h1>
        <p className="mt-4 text-center text-fg-muted">Sign in to schedule and track your email campaigns.</p>

        {message && (
          <p className="mt-8 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {message}
          </p>
        )}

        <a
          href={GOOGLE_LOGIN_URL}
          className="focus-ring mt-10 flex h-[60px] w-full items-center justify-center gap-3 rounded-xl bg-brand-50 text-[19px] text-fg transition-colors hover:bg-brand-100 dark:bg-brand-600/15 dark:hover:bg-brand-600/25"
        >
          <GoogleIcon />
          Login with Google
        </a>
      </div>
    </div>
  );
}
