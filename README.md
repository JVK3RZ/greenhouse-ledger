# Greenhouse Ledger

Greenhouse Ledger is an installable, offline-first plant care and terrarium build tracker.

## Run locally

Service workers require HTTPS or localhost. From this folder, start any static server, such as:

```sh
npx serve .
```

Then open the localhost URL shown by the server.

## Data and privacy

Plant records, care logs, terrarium progress, and notes are stored in IndexedDB on the current device. The offline identifier keeps reference photos on-device. Use **export backup** to move data to another browser or device.

## GitHub Pages

The project contains only static files and can be published directly from a GitHub Pages branch or GitHub Actions workflow.
