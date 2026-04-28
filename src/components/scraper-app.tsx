"use client";

import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

type JobStatus = "idle" | "running" | "done" | "error";

type ExportJob = {
  id: string;
  label: string;
  searchUrl: string;
  status: JobStatus;
  message: string;
  pagesDone: number;
  totalPages: number;
  rows: number;
};

function createJob(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: crypto.randomUUID(),
    label: "",
    searchUrl: "",
    status: "idle",
    message: "",
    pagesDone: 0,
    totalPages: 0,
    rows: 0,
    ...overrides,
  };
}

export function ScraperApp() {
  const [jobs, setJobs] = useState<ExportJob[]>([createJob()]);
  const controllers = useRef(new Map<string, AbortController>());

  function updateJob(id: string, updates: Partial<ExportJob>) {
    setJobs((current) =>
      current.map((job) => (job.id === id ? { ...job, ...updates } : job)),
    );
  }

  function setJobProgress(id: string, message: string, updates: Partial<ExportJob> = {}) {
    setJobs((current) =>
      current.map((job) =>
        job.id === id
          ? {
              ...job,
              ...updates,
              message,
            }
          : job,
      ),
    );
  }

  function addJob() {
    setJobs((current) => [...current, createJob()]);
  }

  function removeJob(id: string) {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setJobs((current) =>
      current.length === 1 ? current : current.filter((job) => job.id !== id),
    );
  }

  function cancelJob(id: string) {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    updateJob(id, {
      status: "idle",
      message: "Cancelled.",
      pagesDone: 0,
      totalPages: 0,
    });
  }

  async function startJob(job: ExportJob) {
    controllers.current.get(job.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(job.id, controller);

    updateJob(job.id, {
      status: "running",
      message: "Starting export...",
      pagesDone: 0,
      totalPages: 0,
      rows: 0,
    });

    try {
      const response = await fetch("/api/export-url-stream", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: job.label,
          searchUrl: job.searchUrl,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Export failed.");
      }

      await readProgressStream(response.body, (event) => handleProgressEvent(job.id, event));
      controllers.current.delete(job.id);
    } catch (caught) {
      controllers.current.delete(job.id);
      if (caught instanceof DOMException && caught.name === "AbortError") {
        updateJob(job.id, {
          status: "idle",
          message: "Cancelled.",
          pagesDone: 0,
          totalPages: 0,
        });
        return;
      }

      updateJob(job.id, {
        status: "error",
        message: caught instanceof Error ? caught.message : "Export failed.",
      });
    }
  }

  function handleProgressEvent(id: string, event: ProgressEventPayload) {
    if (event.type === "status") {
      setJobProgress(id, event.message);
      return;
    }

    if (event.type === "meta") {
      setJobProgress(
        id,
        `Found ${event.totalElements.toLocaleString()} suppliers across ${event.lastPage.toLocaleString()} pages.`,
        { pagesDone: 0, totalPages: event.lastPage, rows: 0 },
      );
      return;
    }

    if (event.type === "page") {
      setJobProgress(
        id,
        `Fetched page ${event.page.toLocaleString()} of ${event.lastPage.toLocaleString()} - ${event.rowCount.toLocaleString()} rows so far.`,
        {
          pagesDone: event.page,
          totalPages: event.lastPage,
          rows: event.rowCount,
        },
      );
      return;
    }

    if (event.type === "file") {
      const blob = base64ToBlob(event.base64, event.contentType);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = event.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setJobProgress(id, `Done. Downloaded ${event.rowCount.toLocaleString()} rows.`, {
        status: "done",
        message: `Done. Downloaded ${event.rowCount.toLocaleString()} rows.`,
        rows: event.rowCount,
      });
      return;
    }

    if (event.type === "error") {
      updateJob(id, {
        status: "error",
        message: event.message,
      });
    }
  }

  return (
    <main className="min-h-screen bg-[#050506] px-4 py-6 text-[#f5f5f7] sm:px-6">
      <section className="mx-auto grid w-full max-w-5xl gap-5">
        <header className="grid gap-1">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold">Canton Fair scraper</h1>
            <p className="text-sm text-[#a1a1a6]">Add jobs, then export each Excel file.</p>
          </div>
        </header>

        <div className="grid gap-4">
          {jobs.map((job, index) => (
            <article
              key={job.id}
              className="grid gap-2 rounded-[1.5rem] border border-white/10 bg-[#151516] p-3 shadow-[0_14px_44px_rgba(0,0,0,0.28)]"
            >
              <div className="grid gap-2 lg:grid-cols-[auto_minmax(150px,220px)_1fr_auto_auto] lg:items-center">
                <div className="flex items-center justify-between gap-3 lg:justify-start">
                  <p className="whitespace-nowrap text-sm font-semibold text-[#d1d1d6]">
                    Job {index + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeJob(job.id)}
                    disabled={jobs.length === 1 || job.status === "running"}
                    aria-label="Remove job"
                    className="inline-flex size-9 items-center justify-center rounded-full border border-white/10 bg-[#222225] text-[#d1d1d6] hover:bg-[#2c2c2e] disabled:cursor-not-allowed disabled:opacity-40 lg:hidden"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <input
                  value={job.label}
                  onChange={(event) => updateJob(job.id, { label: event.target.value })}
                  disabled={job.status === "running"}
                  className="h-10 w-full rounded-full border border-white/14 bg-[#222225] px-4 text-sm text-[#f5f5f7] outline-none placeholder:text-[#8e8e93] focus:border-[#0a84ff] disabled:opacity-60"
                  placeholder="Label / file name"
                />
                <input
                  value={job.searchUrl}
                  onChange={(event) => updateJob(job.id, { searchUrl: event.target.value })}
                  disabled={job.status === "running"}
                  className="h-10 w-full rounded-full border border-white/14 bg-[#222225] px-4 text-sm text-[#f5f5f7] outline-none placeholder:text-[#8e8e93] focus:border-[#0a84ff] disabled:opacity-60"
                  placeholder="https://365.cantonfair.org.cn/en-US/search?..."
                />
                <button
                  type="button"
                  onClick={() => startJob(job)}
                  disabled={job.status === "running"}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-[#0a84ff] px-5 text-sm font-semibold text-white hover:bg-[#2997ff] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {job.status === "running" ? (
                    <Loader2 className="mr-2 animate-spin" size={17} />
                  ) : null}
                  {job.status === "running" ? "Working" : "Start"}
                </button>
                {job.status === "running" ? (
                  <button
                    type="button"
                    onClick={() => cancelJob(job.id)}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-white/14 bg-[#222225] px-5 text-sm font-semibold text-[#f5f5f7] hover:bg-[#2c2c2e]"
                  >
                    <X className="mr-2" size={17} />
                    Cancel
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeJob(job.id)}
                  disabled={jobs.length === 1 || job.status === "running"}
                  aria-label="Remove job"
                  className="hidden size-10 items-center justify-center rounded-full border border-white/10 bg-[#222225] text-[#d1d1d6] hover:bg-[#2c2c2e] disabled:cursor-not-allowed disabled:opacity-40 lg:inline-flex"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {job.message ? (
                <JobProgress job={job} />
              ) : null}
            </article>
          ))}

          <button
            type="button"
            onClick={addJob}
            className="flex min-h-24 w-full items-center justify-center rounded-[2rem] border border-dashed border-white/18 bg-[#151516] px-4 text-sm font-semibold text-[#f5f5f7] shadow-[0_18px_60px_rgba(0,0,0,0.24)] hover:border-white/28 hover:bg-[#1c1c1e]"
          >
            <Plus className="mr-2" size={18} />
            Add job
          </button>
        </div>
      </section>
    </main>
  );
}

type ProgressEventPayload =
  | { type: "status"; message: string }
  | { type: "meta"; totalElements: number; pageCount: number; startPage: number; lastPage: number }
  | { type: "page"; page: number; lastPage: number; pageRows: number; rowCount: number }
  | { type: "file"; filename: string; rowCount: number; contentType: string; base64: string }
  | { type: "error"; message: string };

async function readProgressStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ProgressEventPayload) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onEvent(JSON.parse(line) as ProgressEventPayload);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ProgressEventPayload);
  }
}

function JobProgress({ job }: { job: ExportJob }) {
  const progress =
    job.totalPages > 0 ? Math.min(100, Math.round((job.pagesDone / job.totalPages) * 100)) : 0;

  return (
    <div
      className={
        job.status === "error"
          ? "grid gap-2 rounded-[1rem] border border-red-400/30 bg-red-950/70 px-3 py-2 text-sm text-red-100"
          : "grid gap-2 rounded-[1rem] border border-white/10 bg-[#222225] px-3 py-2 text-sm text-[#d1d1d6]"
      }
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium text-[#f5f5f7]">{job.message}</p>
        {job.totalPages > 0 ? (
          <p className="text-xs text-[#a1a1a6]">
            {job.pagesDone.toLocaleString()} / {job.totalPages.toLocaleString()} pages
          </p>
        ) : null}
      </div>

      {job.totalPages > 0 ? (
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#0a84ff] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

    </div>
  );
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: contentType });
}
