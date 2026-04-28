import crypto from "node:crypto";
import ExcelJS from "exceljs";

const API_URL = "https://appservice.cantonfair.org.cn/v9/exhibition/queryshop";
export const DEFAULT_SEARCH_URL =
  "https://365.cantonfair.org.cn/en-US/search?queryType=2&fCategoryId=461147369757478912&categoryId=461147369757478912";
const DEFAULT_QUERY_TYPE = "2";
const CANTON_FAIR_HOST = "365.cantonfair.org.cn";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

type ApiOfflineShop = {
  categoryName?: string | null;
};

type ApiShop = {
  id?: string | null;
  name?: string | null;
  offlineShops?: ApiOfflineShop[] | null;
};

type QueryResponse = {
  errCode: number;
  errMsg?: string;
  result?: {
    itemList?: ApiShop[];
    totalElements?: number;
    totalCount?: number;
  };
};

export type SupplierRow = {
  name: string;
  industry: string;
  status: "Offline booth" | "Online only";
  supplierId: string;
  page: number;
};

export type ScrapeOptions = {
  searchUrl: string;
  categoryId?: string;
  pageSize?: number;
  startPage?: number;
  endPage?: number;
  maxPages?: number;
  delayMs?: number;
  token?: string;
  onlineIndustryLabel?: string;
  onProgress?: (event: ScrapeProgressEvent) => void | Promise<void>;
  signal?: AbortSignal;
};

export type ScrapeResult = {
  generatedAt: string;
  source: string;
  categoryId: string;
  totalElements: number;
  pageCount: number;
  pagesFetched: number[];
  rows: SupplierRow[];
};

export type ScrapeProgressEvent =
  | { type: "status"; message: string }
  | {
      type: "meta";
      totalElements: number;
      pageCount: number;
      startPage: number;
      lastPage: number;
    }
  | { type: "page"; page: number; lastPage: number; pageRows: number; rowCount: number };

export function parseSearchUrl(searchUrl: string): {
  categoryId: string;
  fCategoryId?: string;
  queryType: string;
} {
  let url: URL;

  try {
    url = new URL(searchUrl);
  } catch {
    throw new Error("Enter a valid Canton Fair search URL.");
  }

  if (url.hostname !== CANTON_FAIR_HOST) {
    throw new Error("Only 365.cantonfair.org.cn supplier search URLs are supported.");
  }

  const categoryId =
    cleanText(url.searchParams.get("categoryId")) ||
    cleanText(url.searchParams.get("fCategoryId"));

  if (!categoryId) {
    throw new Error("The URL must include categoryId or fCategoryId.");
  }

  const fCategoryId = cleanText(url.searchParams.get("fCategoryId"));
  const queryType = cleanText(url.searchParams.get("queryType")) || DEFAULT_QUERY_TYPE;

  return {
    categoryId,
    fCategoryId,
    queryType,
  };
}

export function buildSearchUrl(options: {
  categoryId: string;
  fCategoryId?: string;
  queryType?: string;
}): string {
  const url = new URL("https://365.cantonfair.org.cn/en-US/search");
  const categoryId = cleanText(options.categoryId);
  const fCategoryId = cleanText(options.fCategoryId) || categoryId;
  const queryType = cleanText(options.queryType) || DEFAULT_QUERY_TYPE;

  url.searchParams.set("queryType", queryType);
  url.searchParams.set("fCategoryId", fCategoryId);
  url.searchParams.set("categoryId", categoryId);

  return url.toString();
}

export async function scrapeSuppliers(options: ScrapeOptions): Promise<ScrapeResult> {
  const parsedUrl = parseSearchUrl(options.searchUrl);
  const categoryId = cleanText(options.categoryId) || parsedUrl.categoryId;
  const pageSize = clampInteger(options.pageSize, 40, 1, 100);
  const startPage = clampInteger(options.startPage, 1, 1, 100000);
  const delayMs = clampInteger(options.delayMs, 250, 0, 5000);
  const onlineIndustryLabel = options.onlineIndustryLabel ?? "";
  const emitProgress = async (event: ScrapeProgressEvent) => {
    await options.onProgress?.(event);
  };

  throwIfAborted(options.signal);
  await emitProgress({ type: "status", message: "Resolving Canton Fair access..." });
  const token = await resolveAuthToken(options.searchUrl, options.token, options.signal);
  const deviceId = makeDeviceId();

  throwIfAborted(options.signal);
  await emitProgress({ type: "status", message: "Fetching supplier count..." });
  const firstPage = await fetchPageWithRetry({
    token,
    deviceId,
    categoryId,
    pageIndex: startPage,
    pageSize,
    signal: options.signal,
  });

  const totalElements =
    firstPage.result?.totalElements ??
    firstPage.result?.totalCount ??
    firstPage.result?.itemList?.length ??
    0;
  const pageCount = Math.ceil(totalElements / pageSize);
  const requestedEndPage =
    options.endPage ?? (options.maxPages ? startPage + options.maxPages - 1 : pageCount);
  const lastPage = Math.min(requestedEndPage, pageCount || requestedEndPage);
  const rows: SupplierRow[] = [];
  const pagesFetched: number[] = [];

  await emitProgress({
    type: "meta",
    totalElements,
    pageCount,
    startPage,
    lastPage,
  });

  for (let page = startPage; page <= lastPage; page += 1) {
    throwIfAborted(options.signal);
    const data =
      page === startPage
        ? firstPage
        : await fetchPageWithRetry({
            token,
            deviceId,
            categoryId,
            pageIndex: page,
            pageSize,
            signal: options.signal,
          });

    const shops = data.result?.itemList ?? [];
    pagesFetched.push(page);

    for (const shop of shops) {
      const row = normalizeShop(shop, page, onlineIndustryLabel);
      if (row) {
        rows.push(row);
      }
    }

    await emitProgress({
      type: "page",
      page,
      lastPage,
      pageRows: shops.length,
      rowCount: rows.length,
    });

    if (page < lastPage && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: options.searchUrl,
    categoryId,
    totalElements,
    pageCount,
    pagesFetched,
    rows,
  };
}

export async function buildWorkbookBuffer(rows: SupplierRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "cantonfair-supplier-app";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Suppliers", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  worksheet.columns = [
    { header: "Name", key: "name", width: 44 },
    { header: "Industry", key: "industry", width: 56 },
    { header: "Status", key: "status", width: 16 },
    { header: "Supplier ID", key: "supplierId", width: 24 },
    { header: "Page", key: "page", width: 10 },
  ];

  worksheet.addRows(rows);
  worksheet.autoFilter = "A1:E1";

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF111827" },
  };
  header.alignment = { vertical: "middle" };

  worksheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: rowNumber > 1 };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const parsed = new URL(url);
  if (parsed.hostname !== CANTON_FAIR_HOST) {
    throw new Error("Only Canton Fair site assets can be fetched.");
  }

  const response = await fetch(url, {
    signal,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }

  return response.text();
}

async function resolveAuthToken(
  searchUrl: string,
  tokenOverride?: string,
  signal?: AbortSignal,
): Promise<string> {
  if (tokenOverride) {
    return stripBearer(tokenOverride);
  }

  const html = await fetchText(searchUrl, signal);
  const scriptMatch = html.match(
    /<script[^>]+type=["']module["'][^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i,
  );

  if (!scriptMatch) {
    throw new Error("Could not find the Canton Fair site bundle in the search page.");
  }

  const bundleUrl = new URL(scriptMatch[1], searchUrl).toString();
  const bundle = await fetchText(bundleUrl, signal);
  const tokenMatch = bundle.match(
    /localStorage\.getItem\([^)]+\)\|\|"(eyJ[A-Za-z0-9._-]+)"/,
  );
  const token = tokenMatch?.[1];

  if (!token) {
    throw new Error("Could not find the public anonymous token in the site bundle.");
  }

  return token;
}

function stripBearer(token: string): string {
  return token.replace(/^Bearer\s+/i, "").trim();
}

function makeDeviceId(length = 32): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function fetchPage(options: {
  token: string;
  deviceId: string;
  categoryId: string;
  pageIndex: number;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<QueryResponse> {
  const payload = {
    categoryId: options.categoryId,
    companyType: "",
    pageIndex: options.pageIndex,
    pageSize: options.pageSize,
    searchProductShop: "N",
    searchBooth: "N",
    isOffline: "N",
  };

  const body = new URLSearchParams({
    content: JSON.stringify(payload),
  });

  const response = await fetch(API_URL, {
    method: "POST",
    signal: options.signal,
    headers: {
      Accept: "application/json, text/plain, */*",
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://365.cantonfair.org.cn",
      Referer: "https://365.cantonfair.org.cn/",
      "User-Agent": USER_AGENT,
      "accept-language": "en",
      "cus-os-type": "WEB",
      deviceid: options.deviceId,
      locale: "en",
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Page ${options.pageIndex} failed with HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  const parsed = JSON.parse(text) as QueryResponse;
  if (parsed.errCode !== 0) {
    throw new Error(
      `Page ${options.pageIndex} failed with API ${parsed.errCode}: ${parsed.errMsg ?? "unknown error"}`,
    );
  }

  return parsed;
}

async function fetchPageWithRetry(
  request: Parameters<typeof fetchPage>[0],
  attempts = 3,
): Promise<QueryResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchPage(request);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(800 * attempt);
      }
    }
  }

  throw lastError;
}

function normalizeShop(
  shop: ApiShop,
  page: number,
  onlineIndustryLabel: string,
): SupplierRow | null {
  const name = cleanText(shop.name);
  if (!name) {
    return null;
  }

  const industries = unique(
    (shop.offlineShops ?? [])
      .map((offlineShop) => cleanText(offlineShop?.categoryName))
      .filter((industry): industry is string => Boolean(industry)),
  );

  return {
    name,
    industry: industries.length > 0 ? industries.join(" | ") : onlineIndustryLabel,
    status: industries.length > 0 ? "Offline booth" : "Online only",
    supplierId: cleanText(shop.id),
    page,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!Number.isInteger(value)) {
    throw new Error("Numeric options must be whole numbers.");
  }

  if (value < minimum || value > maximum) {
    throw new Error(`Numeric options must be between ${minimum} and ${maximum}.`);
  }

  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Job cancelled.", "AbortError");
  }
}
