# ADR-025: Content Security Policy without nonces

**Context.** The frontend sent no security headers. A Content Security Policy is the
standard defence-in-depth against injected scripts. The strict form uses a per-request
*nonce* on every script tag. Next.js supports that, but only if every page is rendered
dynamically on each request: no static pages and no CDN caching
(`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`). Separately,
`next-themes` injects a small inline script to set the theme before first paint.

**Options.**
1. Nonce-based CSP via `proxy.ts`. This is the strictest option, but it forces dynamic
   rendering for an app whose pages are client-rendered shells. The inline theme script
   would also need the nonce passed through.
2. CSP in `next.config.ts` headers with `script-src 'self' 'unsafe-inline'`. Pages stay
   static. Inline scripts are allowed, but everything else is locked down.
3. No CSP.

**Chosen: 2.** The policy allows:
- scripts only from this origin, plus inline scripts (`'unsafe-inline'`);
- `connect-src` limited to the API and Supabase;
- no plugins (`object-src 'none'`), no `<base>` rewriting, no framing
  (`frame-ancestors 'none'`).

It ships with `nosniff`, `X-Frame-Options: DENY`, a strict referrer policy and a
Permissions-Policy, and the `X-Powered-By` header is removed. `'unsafe-eval'` is added
only in development, for React's error overlay.

**Consequences.**
- `'unsafe-inline'` means the CSP does not by itself stop an injected inline script.
  That protection comes from React escaping all text and from the app never using
  `dangerouslySetInnerHTML`. Note bodies go through Tiptap's schema, which drops
  anything it doesn't model.
- What the CSP still guarantees: injected code can't load scripts from elsewhere and
  can't send data anywhere except the API and Supabase.
- Checked in a browser: every public page loads in both themes with no CSP violations,
  and sign-in still reaches Supabase.

**Learning note.** A CSP is a list of trade-offs, not a switch. The strictest policy can
cost static rendering; the most permissive one is decoration. Write down which threat
each directive actually stops.
