# Greenhouse Ledger

Greenhouse Ledger is an installable, multi-tenant greenhouse inventory and operations platform.

Current pilot release candidate: `1.15.2` (CSV selling-price aliases).

## Open the app

Open the hosted application at:

**https://jvk3rz.github.io/greenhouse-ledger/**

You do not need to run a GitHub workflow to open Greenhouse Ledger. Approved changes merged into `main` deploy automatically. The **Run workflow** button is only a manual redeployment option.

To install it like an app:

- On iPhone or iPad, open the link in Safari, tap **Share**, then **Add to Home Screen**.
- On Android, open the link in Chrome, open the browser menu, then choose **Install app** or **Add to Home screen**.
- On a desktop browser, use the install icon in the address bar when available.

## Run locally

Service workers require HTTPS or localhost. From this folder, start any static server, such as:

```sh
npx serve .
```

Then open the localhost URL shown by the server.

## Quality checks

Run the same dependency-free quality gate used by GitHub Actions:

```sh
npm test
```

The gate validates JavaScript syntax, PWA shell and cache consistency, manifest assets, migration versioning, and public-source administrative-key patterns.

## Data and privacy

Supabase authentication provides a private organization workspace. Users choose a unique username and may sign in with either that username or their email. **Remember me** persists a session and login identifier only when selected; Greenhouse Ledger never stores raw passwords. Shared production zones, a reusable plant catalog, inventory batches, staff tasks, protected photos, and an auditable stock history are synchronized through Supabase. The business navigation centers on the Dashboard, Inventory, Operations, Team, and Production Zones & Catalog; legacy personal Grow Tent, Room Plants, and Terrarium Build views are no longer presented. Existing device-local records remain untouched. The latest cloud inventory snapshot is cached in IndexedDB for offline viewing; writes resume when the device is online.

Operations also includes a plant-health issue log. Staff can report a pest, disease, damage, or environmental concern against a batch or production zone, optionally attach a protected photo, record its severity, and preserve follow-up notes as the issue moves from open to monitoring or resolved.

During single or bulk receiving, staff can opt into recurring watering and feeding tasks sourced from the selected catalog product. Products without a matching care interval create no task. Observation reports offer separate controls to take a new rear-camera photo on supported mobile devices or choose an existing image.

The Settings menu centralizes account security and business preferences. Organization owners and managers can publish a shared logo and accessible color palette through Brand Studio. Logos remain in private, organization-scoped storage, and the interface can suggest colors locally from a raster logo without uploading it until the user publishes the branding.

The first standalone account creates the organization and becomes its owner. Owners and managers use **Team & Invitations** to create single-use, seven-day, email-locked worker or manager invitations; they can send or resend branded email, copy the same invitation as a private link, view its lifecycle status, revoke it, or replace an expired invitation. Email delivery runs only from the protected `send-organization-invitation` Edge Function and requires `RESEND_API_KEY`, `INVITATION_FROM_EMAIL`, and `GREENHOUSE_LEDGER_SITE_URL` secrets. Link sharing remains available when email delivery is not configured.

Inventory staff can receive several batches in one atomic bulk receipt and run location-specific or whole-workspace physical counts. Counted quantities remain separate from expected ledger quantities until an owner or manager approves the completed count; approved differences create inventory adjustments and activity history.

New owners receive a five-step pilot setup checklist covering production zones, catalog, inventory, care work, and team access. An empty owner workspace can load a guarded sample greenhouse for demonstrations. Invited staff see their organization, role, reserved email, and expiration before accepting, followed by role-specific first-login guidance.

Catalog setup presents products visually and distinguishes a reusable product definition from on-hand inventory. Owners can add one product, choose common starter products, or import a CSV spreadsheet through a plain-language guided flow. Container sizes and active/archive status allow one plant variety to be sold in multiple formats without deleting historical inventory references.

CSV imports accept either `default_price` or `unit_price` as the selling-price heading. Both map to the catalog product's `default_price`; the downloadable template continues to use the preferred `default_price` heading. A file must not include both aliases at once.

When inventory staff select—or change—the catalog product while receiving one or several batches, its default selling price prefills the batch Unit Price. The batch price remains editable, products without a default stay blank, and Unit Cost remains shipment-specific. Batch edits never rewrite the catalog default.

Cloud workspace backups contain organization-scoped database records and may include staff names and invitation email addresses. Store exported JSON files securely. Database photo paths are included, but binary photo files are not embedded.

Phase 18 backups include physical-count and plant-health history. An owner can inspect a version 2 backup and atomically recover records that are missing from the same organization. Recovery never overwrites or deletes existing live records; memberships, invitations, generated activity logs, and photo binaries remain inspection-only. Greenhouse Ledger does not retain downloaded backup files. The recommended policy is to keep the three newest monthly backups plus one backup before a major import or recovery, then delete superseded files after 90 days unless the business requires longer retention.

Phase 19 lets owners and managers correct catalog names, SKUs, container details, pricing and care defaults, plus non-quantity batch details such as code, zone, stage, pricing, acquisition date, and notes. Corrections run through role-checked database functions and preserve before-and-after values in activity history. Quantity remains protected behind stock movements and physical counts. Activity filters change the visible history without deleting accountability records.

Phase 20 expands Settings with a shared workspace profile, inventory labels and code conventions, invitation-email readiness, and product/version information. Owners and managers can maintain business contact and address details, currency, timezone, low-stock behavior, quantity terminology, and suggested SKU and batch prefixes. Organization and branding updates run through membership-checked database functions and leave activity history.

Phase 21 adds an administratively designated, reusable demo identity. Each demo sign-in removes any workspace previously created by that identity and returns to first-owner organization setup. Signing out performs the same tenant-scoped reset, including private photos, while retaining the demo login. Invitation email delivery is disabled in demo mode; link-only invitation lifecycle demonstrations remain available. Ordinary accounts cannot designate themselves as demos or invoke the protected reset endpoint.

Phase 22 lets one account belong to multiple greenhouse organizations, create another isolated workspace, and switch the active organization from the account bar. Each membership retains its own role. Organization creation is atomic and server-authorized, the active choice is checked against current memberships at every sign-in, and switching clears the visible tenant data before the newly selected workspace loads.

Phase 23 adds a platform-owner-only administration dashboard for customer organizations, commercial plans, trials, access status, staff limits, internal support notes, and immutable administration history. Organization suspension is enforced by database membership checks and tenant-table write guards, including protected RPC mutations. Platform administration exposes membership and entitlement metadata but does not expose customer inventory. Existing organizations begin with active complimentary access; newly created organizations receive a 30-day trial until a platform owner changes their plan.

Phase 24 adds organization-specific employee lifecycle management. Owners can promote or demote workers and managers, add additional owners, suspend or reactivate access, and remove members without deleting their historical activity. Managers can manage workers only. Database functions enforce active membership, seat limits, least-privilege role transitions, immutable staff audit entries, and the requirement that every organization retain at least one active owner.

Phase 25 adds Stripe-hosted subscription checkout, an owner-only billing portal, configurable Pilot, Starter, and Growth price mappings, and signed webhook synchronization into the existing entitlement system. Stripe identifiers and webhook receipts remain private, subscription events are idempotent and order-aware, and the browser never receives provider secrets. Production activation requires Stripe price IDs, Edge Function secrets, webhook registration, and separate deployment approval.

Phase 25 Edge Function secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PILOT_PRICE_ID`, `STRIPE_STARTER_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, and the existing `GREENHOUSE_LEDGER_SITE_URL`. Configure the Stripe webhook endpoint for `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`; deploy `stripe-billing-webhook` without Supabase JWT verification because it authenticates Stripe’s raw request signature internally.

## Supabase

The browser uses only the project's publishable key from `supabase-config.js`. Database changes are versioned in `supabase/migrations`; apply them through Supabase before deploying the corresponding frontend.

## GitHub Pages

The deployment workflow runs automatically after every push to `main`, verifies the repository quality gate, and publishes the static PWA to GitHub Pages. It can also be run manually from GitHub Actions when a redeployment is intentionally needed.
 

## Phase 27 — approval-based onboarding (1.17.0)

New owners submit their name, business name, and email through **Request owner account**. Platform Admin lists the private requests and can approve/send, reject, resend, or revoke them. An approved email invitation opens account setup and creates exactly one owner workspace on acceptance. Existing users keep their login; additional customer workspaces also require approval. Platform administrators and the resettable demo retain direct workspace creation.

Team email invitations now include a Supabase Auth activation link. New users set a username and password, then accept the assigned role without a second verification email. Owners can invite workers/managers; managers can invite workers. A copied team link alone cannot create a new account: new users need the email activation link. Seat limits, active organization access, and existing-member protections remain enforced.

### Deployment order

1. Apply `20260901141324_phase_27_approved_onboarding.sql` before publishing the frontend.
2. Deploy `send-owner-activation` and the updated `send-organization-invitation`, including `_shared/activation.ts`.
3. Confirm server-only `RESEND_API_KEY`, verified `INVITATION_FROM_EMAIL`, and `GREENHOUSE_LEDGER_SITE_URL`. No secret belongs in frontend configuration. Auth activation tokens are emailed only to the recipient and never returned to the inviting user.
4. Allow the production site and its query-string invitation callbacks in Supabase Auth redirect URLs. Disable **Allow new users to sign up** in production Auth settings (`enable_signup = false` in this repository does not update a hosted project by itself). Keep email confirmation enabled and anonymous sign-in disabled. Admin-generated invitation links still provision invited users.
5. Publish the frontend. Validate one controlled owner request → approve → email → set credentials → workspace, plus worker and manager invitations. Confirm ordinary direct signup is rejected and existing password/username sign-in still works.

Owner invitation records expire after seven days; the email's Auth sign-in token may expire sooner according to Auth configuration. Resend replaces the owner code. Revocation blocks workspace membership even if the recipient already used the Auth link. It does not delete a pre-provisioned Auth identity or revoke an existing unrelated login. Failed email delivery remains visible and retryable. Requests are deduplicated by email, capped at 200 per day, and return no account-existence information to public callers. Admin review lists the latest 200 requests, prioritizing pending/approved records.

Validation: `node scripts/verify.mjs`; run `supabase/tests/phase_27_onboarding.sql` after the migration inside an explicit transaction followed by `ROLLBACK`. Browser coverage: `node scripts/test-onboarding-browser.mjs` with Playwright installed (or the Codex runtime dependency path). The browser suite stubs Auth/data calls and does not replace the controlled production email smoke test.

Phase 27 verification performed: migration and authorization suite passed in a rolled-back database transaction; repository gate and mocked Edge delivery suite passed locally. Browser suite is included but could not run here because the Chromium download was unavailable. Full Auth email delivery and production signup-disable checks remain rollout gates.
