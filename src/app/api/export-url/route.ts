import { NextResponse } from "next/server";
import { buildWorkbookBuffer, scrapeSuppliers } from "@/lib/cantonfair";

export const runtime = "nodejs";
export const maxDuration = 300;

type ExportUrlRequest = {
  label?: unknown;
  searchUrl?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExportUrlRequest;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const searchUrl = typeof body.searchUrl === "string" ? body.searchUrl.trim() : "";

    if (!searchUrl) {
      return NextResponse.json({ error: "Paste a Canton Fair supplier search URL." }, { status: 400 });
    }

    const result = await scrapeSuppliers({ searchUrl, signal: request.signal });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No supplier rows were found." }, { status: 404 });
    }

    const buffer = await buildWorkbookBuffer(result.rows);
    const workbookBody = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(workbookBody).set(buffer);
    const filename = `${safeFilename(label || "cantonfair-suppliers")}.xlsx`;

    return new Response(workbookBody, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Row-Count": String(result.rows.length),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed." },
      { status: 500 },
    );
  }
}

function safeFilename(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return cleaned || "cantonfair-suppliers";
}
