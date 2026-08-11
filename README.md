# Greenhouse Ledger

Greenhouse Ledger is an installable, offline-first plant care tracker evolving into a multi-tenant greenhouse inventory platform.

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

Supabase authentication provides a private organization workspace. Shared growing locations, a reusable plant catalog, inventory batches, staff tasks, protected photos, and an auditable stock history are synchronized through Supabase. Phase 4 adds inventory valuation, date-range movement reporting, low-stock review, print-ready summaries, and CSV exports. Phase 5 adds floor-ready inventory search, scanner-friendly SKU and batch lookup, direct batch links, and printable batch labels. Phase 6 adds a guided workspace-readiness checklist and validated bulk catalog onboarding from CSV. Phase 7 adds organization-controlled business identity, currency, timezone, and low-stock alert settings. Phase 8 adds an automated repository quality gate for every pull request and update to `main`. Phase 9 adds manager-controlled, integrity-checked cloud workspace backups and read-only backup inspection. Phase 10 establishes automatic quality-gated deployment and a stable installable app URL. The latest cloud inventory snapshot is cached in IndexedDB for offline viewing; writes resume when the device is online. Existing personal plant records, care logs, terrarium progress, and notes remain device-local. Use **export backup** to move those records to another browser or device.

Cloud workspace backups contain organization-scoped database records and may include staff names and invitation email addresses. Store exported JSON files securely. Database photo paths are included, but binary photo files are not embedded.

## Supabase

The browser uses only the project's publishable key from `supabase-config.js`. Database changes are versioned in `supabase/migrations`; apply them through Supabase before deploying the corresponding frontend.

## GitHub Pages

The deployment workflow runs automatically after every push to `main`, verifies the repository quality gate, and publishes the static PWA to GitHub Pages. It can also be run manually from GitHub Actions when a redeployment is intentionally needed.
