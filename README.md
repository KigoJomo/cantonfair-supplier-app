# Canton Fair Supplier Exporter

A small web app that collects suppliers from Canton Fair 365 category searches and writes the result to an XLSX workbook.

[Open the app](https://cantonfair-supplier-app.vercel.app)

## What it exports

Each row contains the supplier name, industry, booth status, supplier ID, and source page. The workbook has a frozen header row, filters, and readable column widths.

You can queue several category URLs, name each export, choose a page range, and watch progress while the server fetches the Canton Fair API. Jobs can also be cancelled.

Only `365.cantonfair.org.cn` supplier search URLs are accepted. The scraper reads the category ID from the URL, obtains the access token used by the public site, retries transient API failures, and waits between pages.

## Run it locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and paste a Canton Fair supplier category URL. No environment variables are required.

## Main routes

| Route | Result |
| --- | --- |
| `/api/scrape` | Supplier rows as JSON |
| `/api/export` | An XLSX workbook from supplied rows |
| `/api/export-url` | Scrapes one URL and returns the workbook |
| `/api/export-url-stream` | Streams scrape progress and the final workbook payload |

The scraper and workbook builder live in [`src/lib/cantonfair.ts`](src/lib/cantonfair.ts).

## Checks

```bash
npm run lint
npm run build
```

The app depends on Canton Fair's current public site and API behaviour. If they change the token flow or response format, exports will stop until the parser catches up.
