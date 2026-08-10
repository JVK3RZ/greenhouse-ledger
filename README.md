# Greenhouse Ledger

Greenhouse Ledger is an installable, offline-first plant care tracker evolving into a multi-tenant greenhouse inventory platform.

## Run locally

Service workers require HTTPS or localhost. From this folder, start any static server, such as:

```sh
npx serve .
```

Then open the localhost URL shown by the server.

## Data and privacy

Supabase authentication provides a private organization workspace. Shared growing locations, a reusable plant catalog, inventory batches, staff tasks, protected photos, and an auditable stock history are synchronized through Supabase. Phase 4 adds inventory valuation, date-range movement reporting, low-stock review, print-ready summaries, and CSV exports. The latest cloud inventory snapshot is cached in IndexedDB for offline viewing; writes resume when the device is online. Existing personal plant records, care logs, terrarium progress, and notes remain device-local. Use **export backup** to move those records to another browser or device.

## Supabase

The browser uses only the project's publishable key from `supabase-config.js`. Database changes are versioned in `supabase/migrations`; apply them through Supabase before deploying the corresponding frontend.

## GitHub Pages

The project contains only static files and can be published directly from a GitHub Pages branch or GitHub Actions workflow.
