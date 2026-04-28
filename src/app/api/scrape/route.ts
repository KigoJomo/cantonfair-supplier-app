import { NextResponse } from "next/server";
import { scrapeSuppliers } from "@/lib/cantonfair";

export const runtime = "nodejs";
export const maxDuration = 300;

type ScrapeRequest = {
  searchUrl?: unknown;
  pageSize?: unknown;
  startPage?: unknown;
  maxPages?: unknown;
  onlineIndustryLabel?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ScrapeRequest;
    const searchUrl = typeof body.searchUrl === "string" ? body.searchUrl.trim() : "";

    if (!searchUrl) {
      return NextResponse.json({ error: "Paste a Canton Fair supplier search URL." }, { status: 400 });
    }

    const result = await scrapeSuppliers({
      searchUrl,
      pageSize: coerceOptionalInteger(body.pageSize),
      startPage: coerceOptionalInteger(body.startPage),
      maxPages: coerceOptionalInteger(body.maxPages),
      onlineIndustryLabel:
        typeof body.onlineIndustryLabel === "string" ? body.onlineIndustryLabel : "",
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scrape failed." },
      { status: 500 },
    );
  }
}

function coerceOptionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
