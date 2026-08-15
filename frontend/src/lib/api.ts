import axios, { type AxiosError } from "axios";

import { supabase } from "./supabase";

export const api = axios.create({
  baseURL: `${process.env.NEXT_PUBLIC_API_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
});

// Attach the current access token to every request. Reading it from the client
// on each call — rather than caching it in a module variable — means a token
// refreshed in another tab is picked up immediately.
api.interceptors.request.use(async (config) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

// One 401 -> one refresh attempt -> one retry. The _retry flag is what stops
// an infinite loop when the refresh itself is what is failing.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      const { data, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && data.session) {
        original.headers.Authorization = `Bearer ${data.session.access_token}`;
        return api(original);
      }
      await supabase.auth.signOut();
      // This interceptor runs outside any component, so there's no
      // useRouter() to call — a full navigation is the only option here.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);
