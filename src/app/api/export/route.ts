import { NextResponse } from "next/server";
import { buildWorkbookBuffer, type SupplierRow } from "@/lib/cantonfair";

export const runtime = "nodejs";
export const maxDuration = 120;

type ExportRequest = {
  rows?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExportRequest;

    if (!Array.isArray(body.rows)) {
      return NextResponse.json({ error: "No supplier rows were provided." }, { status: 400 });
    }

    const rows = body.rows.map(normalizeRow).filter(Boolean) as SupplierRow[];
    if (rows.length === 0) {
      return NextResponse.json({ error: "There are no rows to export." }, { status: 400 });
    }

    const buffer = await buildWorkbookBuffer(rows);
    const workbookBody = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(workbookBody).set(buffer);
    const filename = `cantonfair-suppliers-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;

    return new Response(workbookBody, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed." },
      { status: 500 },
    );
  }
}

function normalizeRow(row: unknown): SupplierRow | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const input = row as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) {
    return null;
  }

  return {
    name,
    industry: typeof input.industry === "string" ? input.industry : "",
    status: input.status === "Offline booth" ? "Offline booth" : "Online only",
    supplierId: typeof input.supplierId === "string" ? input.supplierId : "",
    page: typeof input.page === "number" ? input.page : Number(input.page) || 0,
  };
}
