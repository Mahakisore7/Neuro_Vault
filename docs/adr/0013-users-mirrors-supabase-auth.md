# ADR-013 — `users` mirrors Supabase Auth; it does not reference it

**Problem.** Supabase Auth owns identity in its own `auth.users` table. Our schema needs
a user to hang workspaces, notes, and tags off. Do we foreign-key into `auth.users`, or
keep our own row?

**Alternatives considered.**

- *`FOREIGN KEY REFERENCES auth.users(id)`.* Referential integrity guaranteed by the
  database, deletion cascades for free. It also welds our schema to Supabase's internal
  layout, makes local development impossible, and puts a table we do not control and
  cannot migrate in the middle of our dependency graph.
- *No `users` table; store the JWT `sub` as a bare UUID column everywhere.* No join to
  get a display name; profile data has nowhere to live.
- *A local `users` table whose primary key is the `sub` claim.* Chosen.

**Chosen.**

```sql
CREATE TABLE users (
    id    UUID PRIMARY KEY,        -- NO DEFAULT: the value is the JWT "sub" claim
    email CITEXT NOT NULL UNIQUE,
    ...
);
```

The missing `DEFAULT gen_random_uuid()` is the entire decision, in one line. This table
does not mint identities — it records ones that already exist. A row is created on first
authenticated request, from verified claims, with an `IntegrityError` guard for the case
where two concurrent requests both find nothing.

**Trade-offs.** We accept that a user deleted in Supabase leaves a row here until a
cleanup job removes it. That is a real cost, and it is small: the row is inert without a
valid token, and it keeps foreign keys from every other table pointing at something that
exists. The alternative — a hard FK — trades that small inconsistency for a hard
coupling to a schema we do not own.

**Industry practice.** This is the standard shape for any application using an external
identity provider — Auth0, Clerk, Cognito, Okta. The IdP owns authentication; your
database owns *your* domain's concept of a user. The `sub` claim is the join key.

**Learning note.** It is the same instinct as not foreign-keying into a third-party API.
A foreign key is a promise the database enforces forever; only make it across a boundary
you control.
