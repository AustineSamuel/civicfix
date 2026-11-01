"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { BadgeCheck, Clock3, FileCheck2, MapPin, UploadCloud } from "lucide-react";
import { apiBase, apiRequest, getToken, Report } from "@/lib/api";

type HistoryEntry = {
  previousStatus: string | null;
  newStatus: string;
  reason: string;
  auditEventHash: string;
  blockchainStatus: string;
  transactionHash: string | null;
  createdAt: string;
};

type Evidence = {
  id: string;
  contentHash: string;
  manifestHash: string;
  mimeType: string;
  fileSize: number;
  evidenceType: string;
  createdAt: string;
};

type BlockchainRecord = {
  id: string;
  transactionType: string;
  processingStatus: string;
  transactionHash: string | null;
  blockNumber: string | null;
  createdAt: string;
};

type IntegrityResult = {
  status: string;
  verified: boolean;
  checks: Array<{ transactionId: string; verified: boolean }>;
};

function label(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export default function ReportDetailPage() {
  const params = useParams<{ reportId: string }>();
  const reportId = params.reportId;
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [privateEvidence, setPrivateEvidence] = useState<Evidence[] | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [evidenceType, setEvidenceType] = useState("INITIAL_REPORT");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [evidenceRefresh, setEvidenceRefresh] = useState(0);
  const [blockchainRecords, setBlockchainRecords] = useState<BlockchainRecord[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [integrityUnavailable, setIntegrityUnavailable] = useState(false);

  useEffect(() => {
    setToken(getToken());
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    apiRequest<Evidence[]>(`/reports/${encodeURIComponent(reportId)}/evidence`, {}, token)
      .then((result) => { if (active) setPrivateEvidence(result); })
      .catch(() => { if (active) setPrivateEvidence(null); });
    return () => { active = false; };
  }, [reportId, token, evidenceRefresh]);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<Report>(`/reports/${encodeURIComponent(reportId)}`),
      apiRequest<HistoryEntry[]>(`/reports/${encodeURIComponent(reportId)}/history`)
    ]).then(([reportResult, historyResult]) => {
      if (active) {
        setReport(reportResult);
        setHistory(historyResult);
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "The report could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [reportId]);

  useEffect(() => {
    let active = true;
    apiRequest<BlockchainRecord[]>(`/reports/${encodeURIComponent(reportId)}/blockchain`)
      .then((result) => { if (active) setBlockchainRecords(result); })
      .catch(() => { if (active) setIntegrityUnavailable(true); });
    apiRequest<IntegrityResult>(`/reports/${encodeURIComponent(reportId)}/integrity`)
      .then((result) => {
        if (active) {
          setIntegrity(result);
          setIntegrityUnavailable(false);
        }
      })
      .catch(() => { if (active) setIntegrityUnavailable(true); });
    return () => { active = false; };
  }, [reportId]);

  async function uploadEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedFile) return;
    setUploading(true);
    setUploadError("");
    const body = new FormData();
    body.set("file", selectedFile);
    body.set("evidenceType", evidenceType);
    try {
      await apiRequest(`/reports/${encodeURIComponent(reportId)}/evidence`, {
        method: "POST",
        body
      }, token);
      setSelectedFile(null);
      setEvidenceRefresh((value) => value + 1);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "Evidence upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function openEvidence(evidenceId: string) {
    if (!token) return;
    try {
      const response = await fetch(`${apiBase}/evidence/${encodeURIComponent(evidenceId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Evidence request failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `civicfix-evidence-${evidenceId}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "Evidence could not be opened.");
    }
  }

  if (loading) {
    return <main className="page-width py-16" aria-live="polite">Loading report history…</main>;
  }
  if (error || !report) {
    return (
      <main className="page-width py-16">
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error || "Report not found."}</p>
        <Link href="/" className="focus-ring mt-4 inline-block rounded text-[var(--green)] underline">Back to public reports</Link>
      </main>
    );
  }

  return (
    <main className="page-width max-w-4xl py-12">
      <Link href="/" className="focus-ring rounded text-sm font-medium text-[var(--green)] underline underline-offset-2">← All public reports</Link>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">{report.publicCaseNumber}</p>
        <span className="rounded-full bg-[var(--mint)] px-3 py-1 text-xs font-semibold text-[var(--green)]">{label(report.currentStatus)}</span>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{report.title}</h1>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--muted)]">
        <span>{label(report.category)}</span>
        <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden="true" />{report.approximateLocation}</span>
        <span>{new Date(report.createdAt).toLocaleDateString()}</span>
      </div>
      <section className="mt-8 rounded-xl border border-[var(--line)] bg-white p-6 sm:p-8">
        <p className="eyebrow">Resident-reported description</p>
        <p className="mt-3 whitespace-pre-wrap text-[1.03rem] leading-8 text-[#34433c]">{report.description}</p>
      </section>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-[var(--line)] bg-white p-5">
          <div className="flex items-center gap-2 font-semibold"><FileCheck2 size={18} className="text-[var(--green)]" aria-hidden="true" /> Evidence integrity</div>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {report.evidenceCount} evidence item{report.evidenceCount === 1 ? "" : "s"} recorded. Files and their hashes are private to the reporter and authorized reviewers.
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">A matching hash can show that a stored file has not changed; it does not prove authenticity, location, or capture time.</p>
        </section>
        <section className="rounded-xl border border-[var(--line)] bg-white p-5">
          <div className="flex items-center gap-2 font-semibold"><BadgeCheck size={18} className="text-[var(--green)]" aria-hidden="true" /> Verification status</div>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {report.currentStatus === "RESOLVED"
              ? "An independent verifier recorded this case as resolved."
              : ["VERIFIED", "ASSIGNED", "IN_PROGRESS", "REPAIR_REPORTED_COMPLETE", "PENDING_INDEPENDENT_VERIFICATION", "REOPENED_FOR_REPAIR"].includes(report.currentStatus)
                ? "A reviewer verified the reported issue. Repair completion is shown separately in the history."
                : "This report has not yet been marked verified by an authorized reviewer."}
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            {integrityUnavailable
              ? "The registry could not be checked right now; no verified status is claimed."
              : integrity?.status === "NOT_CONFIGURED"
                ? "No blockchain registry is configured. This case is not represented as on-chain."
                : integrity?.status === "MISMATCH"
                  ? "At least one stored commitment does not match the registry. Do not rely on this record until reviewed."
                    : integrity?.status === "PENDING"
                      ? "A blockchain transaction is still pending; no confirmed commitment is claimed yet."
                      : integrity?.status === "FAILED"
                        ? "At least one commitment could not be verified against the registry."
                    : integrity?.status === "VERIFIED"
                      ? "Stored commitments were read from the configured registry and matched."
                      : integrity?.status === "NO_COMMITMENTS"
                        ? "No audit commitments have been submitted for this report."
                        : "Checking the configured registry…"}
          </p>
        </section>
      </div>

      {blockchainRecords.length > 0 && (
        <section className="mt-5 rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="font-semibold">Blockchain transaction history</h2>
          <ul className="mt-3 space-y-3">
            {blockchainRecords.map((record) => (
              <li key={record.id} className="border-t border-[var(--line)] pt-3 text-sm">
                <p className="font-medium">{label(record.transactionType)} · {label(record.processingStatus)}</p>
                <p className="mt-1 break-all font-mono text-xs text-[var(--muted)]">
                  {record.transactionHash ?? "No transaction hash recorded"}
                  {record.blockNumber ? ` · block ${record.blockNumber}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {privateEvidence !== null && (
        <section className="mt-5 rounded-xl border border-[var(--line)] bg-white p-5 sm:p-6">
          <h2 className="font-semibold">Private evidence access</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Only authorized accounts can see this list or retrieve these files. Public report visitors cannot access the evidence.</p>
          {privateEvidence.length > 0 && (
            <ul className="mt-4 space-y-3">
              {privateEvidence.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3 text-sm">
                  <span>{label(item.evidenceType)} · {Math.ceil(item.fileSize / 1024)} KB · {new Date(item.createdAt).toLocaleString()}</span>
                  <span className="font-mono text-xs text-[var(--muted)]">SHA-256 {item.contentHash.slice(0, 12)}…</span>
                  <button type="button" onClick={() => void openEvidence(item.id)} className="focus-ring rounded font-semibold text-[var(--green)] underline">Download private file</button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={uploadEvidence} className="mt-5 grid gap-3 border-t border-[var(--line)] pt-5 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <label className="text-sm font-medium">
              Add evidence
              <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} className="focus-ring mt-2 block w-full rounded-lg border border-[var(--line)] p-2 text-sm" />
            </label>
            <label className="text-sm font-medium">
              Evidence type
              <select value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)} className="focus-ring mt-2 h-10 rounded-lg border border-[var(--line)] bg-white px-2">
                <option value="INITIAL_REPORT">Initial report</option>
                <option value="ADDITIONAL_INFORMATION">Additional information</option>
                <option value="REPAIR">Repair evidence</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <button disabled={uploading || !selectedFile} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--green)] px-4 font-semibold text-white disabled:opacity-50">
              <UploadCloud size={16} aria-hidden="true" />{uploading ? "Uploading…" : "Upload"}
            </button>
            {uploadError && <p role="alert" className="text-sm text-red-700 sm:col-span-3">{uploadError}</p>}
          </form>
        </section>
      )}

      <section className="mt-10">
        <div className="flex items-center gap-2">
          <Clock3 size={19} className="text-[var(--green)]" aria-hidden="true" />
          <h2 className="text-xl font-semibold">Public case history</h2>
        </div>
        {history.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">No history has been recorded yet.</p>
        ) : (
          <ol className="mt-5 space-y-3">
            {history.map((entry, index) => (
              <li key={entry.auditEventHash} className="relative rounded-xl border border-[var(--line)] bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{label(entry.newStatus)}</p>
                  <time className="text-xs text-[var(--muted)]" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{entry.reason}</p>
                <p className="mt-3 break-all font-mono text-[0.68rem] text-[var(--muted)]">Audit digest: {entry.auditEventHash}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">Blockchain: {label(entry.blockchainStatus)}{entry.transactionHash ? ` · ${entry.transactionHash}` : ""}</p>
                {index > 0 && <span className="sr-only">Previous status: {entry.previousStatus ? label(entry.previousStatus) : "none"}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
