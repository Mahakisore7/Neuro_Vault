# ADR-008 — Row Level Security is a real boundary

**Problem.** The browser holds `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Anyone can open the
console and query Supabase directly, bypassing FastAPI entirely.

**Chosen.** RLS enabled on every table with a deny-by-default policy, plus explicit
policies for the Storage bucket. The backend connects with a role that bypasses RLS,
so server-side queries are unaffected.

This gets real SQL in [`03-SQL-LAYER.md`](../phases/New/03-SQL-LAYER.md), not a
paragraph of prose. It is the single most important security control in a Supabase
architecture, and the previous doc set gave it four sentences and no code.
