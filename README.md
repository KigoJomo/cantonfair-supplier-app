# Canton Fair Supplier App

Simple Next.js web app for scraping one or more Canton Fair 365 supplier category URLs and exporting each job to XLSX.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Use

1. Add a job.
2. Enter a label. This becomes the downloaded file name.
3. Paste a Canton Fair supplier category URL.
4. Click `Start` for each job you want to run.

## Notes

- Scraping runs server-side in `src/lib/cantonfair.ts`.
- `/api/scrape` returns the supplier rows as JSON.
- `/api/export` builds the workbook with ExcelJS and returns an `.xlsx` file.
- `/api/export-url` scrapes a URL and returns the `.xlsx` file in one request.
- `/api/export-url-stream` streams progress updates, then returns the workbook payload for the UI download.
- The app only accepts `365.cantonfair.org.cn` supplier search URLs.
