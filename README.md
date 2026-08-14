# Greenhouse Ledger

Greenhouse Ledger is an installable, multi-tenant greenhouse inventory and operations platform.

Current pilot release candidate: `1.11.1` (Phase 21 catalog interaction hotfix).

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

The Settings menu centralizes account security and business preferences. Organization owners and managers can publish a shared logo and accessible color palette through Brand Studio. Logos remain in private, organization-scoped storage, and the interface can suggest colors locally from a raster logo without uploading it until the user publishes the branding.

The first standalone account creates the organization and becomes its owner. Owners and managers use **Team & Invitations** to create single-use, seven-day, email-locked worker or manager invitations; they can send or resend branded email, copy the same invitation as a private link, view its lifecycle status, revoke it, or replace an expired invitation. Email delivery runs only from the protected `send-organization-invitation` Edge Function and requires `RESEND_API_KEY`, `INVITATION_FROM_EMAIL`, and `GREENHOUSE_LEDGER_SITE_URL` secrets. Link sharing remains available when email delivery is not configured.

Inventory staff can receive several batches in one atomic bulk receipt and run location-specific or whole-workspace physical counts. Counted quantities remain separate from expected ledger quantities until an owner or manager approves the completed count; approved differences create inventory adjustments and activity history.

New owners receive a five-step pilot setup checklist covering production zones, catalog, inventory, care work, and team access. An empty owner workspace can load a guarded sample greenhouse for demonstrations. Invited staff see their organization, role, reserved email, and expiration before accepting, followed by role-specific first-login guidance.

Catalog setup presents products visually and distinguishes a reusable product definition from on-hand inventory. Owners can add one product, choose common starter products, or import a CSV spreadsheet through a plain-language guided flow. Container sizes and active/archive status allow one plant variety to be sold in multiple formats without deleting historical inventory references.

Cloud workspace backups contain organization-scoped database records and may include staff names and invitation email addresses. Store exported JSON files securely. Database photo paths are included, but binary photo files are not embedded.

Phase 18 backups include physical-count and plant-health history. An owner can inspect a version 2 backup and atomically recover records that are missing from the same organization. Recovery never overwrites or deletes existing live records; memberships, invitations, generated activity logs, and photo binaries remain inspection-only. Greenhouse Ledger does not retain downloaded backup files. The recommended policy is to keep the three newest monthly backups plus one backup before a major import or recovery, then delete superseded files after 90 days unless the business requires longer retention.

Phase 19 lets owners and managers correct catalog names, SKUs, container details, pricing and care defaults, plus non-quantity batch details such as code, zone, stage, pricing, acquisition date, and notes. Corrections run through role-checked database functions and preserve before-and-after values in activity history. Quantity remains protected behind stock movements and physical counts. Activity filters change the visible history without deleting accountability records.

Phase 20 expands Settings with a shared workspace profile, inventory labels and code conventions, invitation-email readiness, and product/version information. Owners and managers can maintain business contact and address details, currency, timezone, low-stock behavior, quantity terminology, and suggested SKU and batch prefixes. Organization and branding updates run through membership-checked database functions and leave activity history.

Phase 21 adds an administratively designated, reusable demo identity. Each demo sign-in removes any workspace previously created by that identity and returns to first-owner organization setup. Signing out performs the same tenant-scoped reset, including private photos, while retaining the demo login. Invitation email delivery is disabled in demo mode; link-only invitation lifecycle demonstrations remain available. Ordinary accounts cannot designate themselves as demos or invoke the protected reset endpoint.

## Supabase

The browser uses only the project's publishable key from `supabase-config.js`. Database changes are versioned in `supabase/migrations`; apply them through Supabase before deploying the corresponding frontend.

## GitHub Pages

The deployment workflow runs automatically after every push to `main`, verifies the repository quality gate, and publishes the static PWA to GitHub Pages. It can also be run manually from GitHub Actions when a redeployment is intentionally needed.
