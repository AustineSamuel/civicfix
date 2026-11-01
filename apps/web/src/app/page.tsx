"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, ClipboardList, Search, ShieldCheck } from "lucide-react";
import { apiRequest, Report, ReportPage } from "@/lib/api";

const statuses = ["All statuses", "NEW", "UNDER_REVIEW", "VERIFIED", "IN_PROGRESS", "RESOLVED"];
const categories = ["All categories", "ROAD", "STREETLIGHT", "WATER", "DRAINAGE", "SANITATION", "COMMUNITY_FACILITY", "OTHER"];

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export default function HomePage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState(statuses[0]);
  const [category, setCategory] = useState(categories[0]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setQueryRefresh] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status !== statuses[0]) params.set("status", status);
    if (category !== categories[0]) params.set("category", category);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [status, category, search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<ReportPage>(`/reports${query ? `?${query}` : ""}`)
      .then((result) => {
        if (active) setReports(result.data);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Reports could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [query, refresh]);

  return (
    <main>
      <section className="border-b border-[var(--line)] bg-white">
        <div className="page-width grid gap-12 py-16 md:grid-cols-[1.1fr_0.9fr] md:items-center md:py-24">
          <div>
            <p className="eyebrow">Public infrastructure, accountable</p>
            <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-6xl">
              Make local problems harder to ignore.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">
              Report damaged infrastructure, share evidence, and follow each review and repair through a public history.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/reports/new" className="focus-ring inline-flex items-center gap-2 rounded-lg bg-[var(--green)] px-5 py-3 font-semibold text-white hover:bg-[var(--green-dark)]">
                Report an issue <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <a href="#reports" className="focus-ring rounded-lg border border-[var(--line)] px-5 py-3 font-semibold hover:bg-[var(--paper)]">
                Browse public reports
              </a>
            </div>
            <p className="mt-5 text-sm text-[var(--muted)]">No wallet required. Personal details and evidence stay off-chain.</p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-7 sm:p-9">
            <p className="eyebrow">How a case moves</p>
            <ol className="mt-6 space-y-5">
              {[
                ["01", "Reported by a resident", "A claim with a location and supporting evidence."],
                ["02", "Reviewed by a community reviewer", "A decision and its reason are added to the case history."],
                ["03", "Repaired and independently checked", "A completion claim is not the same as a verified repair."]
              ].map(([number, title, detail]) => (
                <li key={number} className="flex gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--mint)] text-sm font-bold text-[var(--green)]">{number}</span>
                  <div>
                    <h2 className="font-semibold">{title}</h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-7 flex gap-3 border-t border-[var(--line)] pt-5 text-sm leading-6 text-[var(--muted)]">
              <ShieldCheck className="mt-0.5 shrink-0 text-[var(--green)]" size={18} aria-hidden="true" />
              <p>Blockchain records can help detect changes to audit commitments. They cannot prove that a report is true.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="reports" className="page-width py-16">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Community issue tracker</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Public reports</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-[var(--muted)]">
            Statuses distinguish new reports from reviewer-verified cases and independently confirmed repairs.
          </p>
        </div>
        <div className="mt-7 grid gap-3 md:grid-cols-[1fr_190px_220px]">
          <label className="relative">
            <span className="sr-only">Search reports</span>
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by case number or title" className="focus-ring h-11 w-full rounded-lg border border-[var(--line)] bg-white pl-10 pr-3 text-sm" />
          </label>
          <label>
            <span className="sr-only">Filter by status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="focus-ring h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm">
              {statuses.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="focus-ring h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm">
              {categories.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-6" aria-live="polite">
          {loading && <p className="rounded-xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)]">Loading public reports…</p>}
          {!loading && error && (
            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-[var(--amber)]">
              <p className="font-semibold">Reports are unavailable</p>
              <p className="mt-1">{error} Check that the API is running, then retry.</p>
              <button onClick={() => setQueryRefresh((value) => value + 1)} className="focus-ring mt-3 rounded underline underline-offset-2">Retry</button>
            </div>
          )}
          {!loading && !error && reports.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-white p-10 text-center">
              <ClipboardList className="mx-auto text-[var(--muted)]" size={28} aria-hidden="true" />
              <p className="mt-3 font-semibold">No reports match these filters</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Try another search or submit the first report for your area.</p>
            </div>
          )}
          {!loading && !error && reports.length > 0 && (
            <ul className="grid gap-3">
              {reports.map((report) => <li key={report.id}><ReportCard report={report} /></li>)}
            </ul>
          )}
        </div>
      </section>

      <section className="border-y border-[var(--line)] bg-[var(--mint)]">
        <div className="page-width grid gap-7 py-12 md:grid-cols-[auto_1fr_auto] md:items-center">
          <BadgeCheck size={30} className="text-[var(--green)]" aria-hidden="true" />
          <div>
            <h2 className="text-xl font-semibold">Integrity without overclaiming</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">Evidence remains private off-chain. A cryptographic digest can reveal whether a stored file changed, while human review determines what the evidence supports.</p>
          </div>
          <Link href="/reports/new" className="focus-ring w-fit rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[var(--green)]">Get involved <ArrowRight className="ml-1 inline" size={15} aria-hidden="true" /></Link>
        </div>
      </section>
    </main>
  );
}

function ReportCard({ report }: { report: Report }) {
  const verified = ["VERIFIED", "RESOLVED"].includes(report.currentStatus);
  return (
    <Link href={`/reports/${report.id}`} className="focus-ring block rounded-xl border border-[var(--line)] bg-white p-5 transition hover:border-[#9dbca9] hover:shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-bold tracking-[0.08em] text-[var(--muted)]">{report.publicCaseNumber}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${verified ? "bg-[var(--mint)] text-[var(--green)]" : "bg-[#f0f2ef] text-[#53625c]"}`}>
          {verified && <BadgeCheck size={13} aria-hidden="true" />}
          {statusLabel(report.currentStatus)}
        </span>
      </div>
      <h3 className="mt-3 text-lg font-semibold">{report.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{report.description}</p>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>{statusLabel(report.category)}</span>
        <span>{report.approximateLocation}</span>
        <span>{new Date(report.createdAt).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}
