"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Check, ChevronLeft, ChevronRight, UploadCloud } from "lucide-react";
import { createReportSchema, categories, type CreateReportInput } from "@civicfix/shared";
import { apiRequest, getToken, Report } from "@/lib/api";

const steps = ["Issue", "Location", "Evidence", "Review"];

export default function NewReportPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const {
    register,
    trigger,
    watch,
    handleSubmit,
    formState: { errors }
  } = useForm<z.input<typeof createReportSchema>, unknown, CreateReportInput>({
    resolver: zodResolver(createReportSchema),
    defaultValues: {
      category: "ROAD",
      title: "",
      description: "",
      approximateLocation: "",
      locationPrecision: "APPROXIMATE"
    }
  });
  const form = watch();
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Report | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    setToken(getToken());
    setAuthReady(true);
  }, []);

  async function continueForm() {
    setError("");
    const valid = step === 0
      ? await trigger(["category", "title", "description"])
      : step === 1 ? await trigger("approximateLocation") : true;
    if (!valid) {
      setError("Check the highlighted fields before continuing.");
      return;
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function submit(data: CreateReportInput) {
    if (!authReady) {
      return <main className="page-width py-16" aria-live="polite">Checking your sign-in…</main>;
    }

    if (!token) {
      router.push("/auth");
      return;
    }
    setPending(true);
    setError("");
    try {
      const report = await apiRequest<Report>("/reports", {
        method: "POST",
        body: JSON.stringify(data)
      }, token);
      setCreated(report);
      for (const file of files) {
        const upload = new FormData();
        upload.set("file", file);
        await apiRequest(`/reports/${report.id}/evidence`, {
          method: "POST",
          body: upload
        }, token);
      }
      router.push(`/reports/${report.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report could not be submitted.");
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <main className="page-width max-w-2xl py-16">
        <p className="eyebrow">New report</p>
        <h1 className="mt-2 text-3xl font-semibold">Sign in to submit a report</h1>
        <p className="mt-3 text-[var(--muted)]">A resident account is required to submit a report and keep track of follow-up requests.</p>
        <Link href="/auth" className="focus-ring mt-6 inline-flex rounded-lg bg-[var(--green)] px-5 py-3 font-semibold text-white">Sign in or create an account</Link>
      </main>
    );
  }

  return (
    <main className="page-width max-w-3xl py-12">
      <p className="eyebrow">Resident report</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Tell us what needs attention</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">A report begins as a resident claim. Reviewers make verification decisions separately.</p>
      <ol aria-label="Report steps" className="mt-8 grid grid-cols-4 border-b border-[var(--line)]">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined} className={`border-b-2 pb-3 text-center text-xs font-semibold sm:text-sm ${index === step ? "border-[var(--green)] text-[var(--green)]" : "border-transparent text-[var(--muted)]"}`}>
            <span className="block">{index + 1}. {label}</span>
          </li>
        ))}
      </ol>
      <form onSubmit={handleSubmit(submit)} className="mt-6 rounded-xl border border-[var(--line)] bg-white p-6 sm:p-8">
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Describe the issue</h2>
            <label className="block text-sm font-medium">
              Problem category
              <select {...register("category")} className="focus-ring mt-2 h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3">
                {categories.map((category) => <option value={category} key={category}>{category.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Short title
              <input {...register("title")} minLength={8} maxLength={120} required className="focus-ring mt-2 h-11 w-full rounded-lg border border-[var(--line)] px-3" placeholder="For example, broken streetlight by the library" />
              {errors.title && <span className="mt-1 block text-sm text-red-700">{errors.title.message}</span>}
            </label>
            <label className="block text-sm font-medium">
              What did you observe?
              <textarea {...register("description")} minLength={20} maxLength={4000} required rows={5} className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2.5" placeholder="Describe the issue and how it affects people. Avoid including private information." />
              {errors.description && <span className="mt-1 block text-sm text-red-700">{errors.description.message}</span>}
              <span className="mt-1 block font-normal text-[var(--muted)]">{(form.description ?? "").length}/4000 characters</span>
            </label>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Give an approximate location</h2>
            <p className="text-sm leading-6 text-[var(--muted)]">A manual description is enough. CivicFix does not require browser geolocation. Do not enter a private home address.</p>
            <label className="block text-sm font-medium">
              Public location description
              <textarea {...register("approximateLocation")} required minLength={3} maxLength={240} rows={3} className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2.5" placeholder="Street, nearby landmark, or public facility" />
              {errors.approximateLocation && <span className="mt-1 block text-sm text-red-700">{errors.approximateLocation.message}</span>}
            </label>
            <p className="rounded-lg bg-[var(--mint)] p-4 text-sm leading-6 text-[var(--green-dark)]">Only this approximate description is shown publicly. Coordinates are not requested in this form.</p>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Add supporting photographs</h2>
            <p className="text-sm leading-6 text-[var(--muted)]">Evidence uploads are private to the reporter and authorized reviewers. CivicFix records a SHA-256 integrity hash; that does not prove when or where a photo was taken.</p>
            <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#aac4b2] bg-[#fbfdfb] p-5 text-center">
              <UploadCloud size={25} className="text-[var(--green)]" aria-hidden="true" />
              <span className="mt-2 font-semibold">Choose image files</span>
              <span className="mt-1 text-xs text-[var(--muted)]">JPEG, PNG, or WebP; up to 10 MB per image</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
            </label>
            {files.length > 0 && <ul className="list-inside list-disc text-sm text-[var(--muted)]">{files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name} ({Math.ceil(file.size / 1024)} KB)</li>)}</ul>}
            <p className="rounded-lg bg-amber-50 p-4 text-sm leading-6 text-[var(--amber)]">Before uploading, remove or avoid images with faces, vehicle plates, personal documents, or other sensitive information.</p>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Review before submission</h2>
            <dl className="grid gap-4 rounded-lg bg-[var(--paper)] p-5 text-sm sm:grid-cols-[150px_1fr]">
              <dt className="font-semibold">Category</dt><dd>{form.category.replaceAll("_", " ")}</dd>
              <dt className="font-semibold">Title</dt><dd>{form.title}</dd>
              <dt className="font-semibold">Description</dt><dd className="whitespace-pre-wrap">{form.description}</dd>
              <dt className="font-semibold">Approximate location</dt><dd>{form.approximateLocation}</dd>
              <dt className="font-semibold">Attachments</dt><dd>{files.length} image{files.length === 1 ? "" : "s"}</dd>
            </dl>
            <p className="text-sm leading-6 text-[var(--muted)]">Submitting creates a public report. Your name and email are not included in its public response. Evidence remains private and is not placed on a blockchain.</p>
          </div>
        )}
        {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}{created && <> The report was created as {created.publicCaseNumber}; retry evidence upload from its detail page.</>}</p>}
        <div className="mt-8 flex justify-between gap-3 border-t border-[var(--line)] pt-5">
          <button type="button" onClick={() => { setStep((current) => Math.max(0, current - 1)); setError(""); }} disabled={step === 0 || pending} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-4 py-2.5 font-semibold disabled:opacity-40">
            <ChevronLeft size={17} aria-hidden="true" /> Back
          </button>
          {step < steps.length - 1 ? (
            <button type="button" onClick={continueForm} className="focus-ring inline-flex items-center gap-1 rounded-lg bg-[var(--green)] px-4 py-2.5 font-semibold text-white hover:bg-[var(--green-dark)]">
              Continue <ChevronRight size={17} aria-hidden="true" />
            </button>
          ) : (
            <button disabled={pending} className="focus-ring inline-flex items-center gap-2 rounded-lg bg-[var(--green)] px-4 py-2.5 font-semibold text-white hover:bg-[var(--green-dark)] disabled:opacity-60">
              {pending ? "Submitting…" : <><Check size={17} aria-hidden="true" /> Submit report</>}
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
