import { buildWorkbookBuffer, scrapeSuppliers } from "@/lib/cantonfair";

export const runtime = "nodejs";
export const maxDuration = 300;

type ExportUrlRequest = {
  label?: unknown;
  searchUrl?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ExportUrlRequest;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const searchUrl = typeof body.searchUrl === "string" ? body.searchUrl.trim() : "";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        if (!searchUrl) {
          send({ type: "error", message: "Paste a Canton Fair supplier search URL." });
          return;
        }

        send({ type: "status", message: "Starting export..." });

        const result = await scrapeSuppliers({
          searchUrl,
          onProgress: send,
          signal: request.signal,
        });

        if (result.rows.length === 0) {
          send({ type: "error", message: "No supplier rows were found." });
          return;
        }

        send({ type: "status", message: "Building Excel workbook..." });
        const buffer = await buildWorkbookBuffer(result.rows);
        const filename = `${safeFilename(label || "cantonfair-suppliers")}.xlsx`;

        send({
          type: "file",
          filename,
          rowCount: result.rows.length,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          base64: buffer.toString("base64"),
        });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Export failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}

function safeFilename(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return cleaned || "cantonfair-suppliers";
}
