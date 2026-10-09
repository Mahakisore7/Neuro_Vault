import { createClient } from "@supabase/supabase-js";

// What kind of auth redirect this page load came from, read BEFORE the
// client below parses (and then clears) the URL fragment. "recovery" is a
// password-reset link; error_code is set when a link was expired or reused.
// Pages use it to route a reset link to /reset-password instead of treating
// it as an ordinary sign-in.
const fragment =
  typeof window === "undefined" ? null : new URLSearchParams(window.location.hash.slice(1));
export const authRedirect = {
  type: fragment?.get("type") ?? null,
  errorCode: fragment?.get("error_code") ?? null,
};

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
