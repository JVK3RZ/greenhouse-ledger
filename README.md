# Greenhouse Ledger

Greenhouse Ledger is an installable, offline-first plant care tracker evolving into a multi-tenant greenhouse inventory platform.

## Run locally

Service workers require HTTPS or localhost. From this folder, start any static server, such as:

```sh
npx serve .
```

Then open the localhost URL shown by the server.

## Data and privacy

Phase 1 adds Supabase authentication and a private organization workspace. Existing plant records, care logs, terrarium progress, and notes remain in IndexedDB on the current device until the inventory synchronization phase. Use **export backup** to move those offline records to another browser or device.

## Supabase

The browser uses only the project's publishable key from `supabase-config.js`. Database changes are versioned in `supabase/migrations`; apply them through Supabase before deploying the corresponding frontend.

## GitHub Pages

The project contains only static files and can be published directly from a GitHub Pages branch or GitHub Actions workflow.
