import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CircleCheck } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "CivicFix — Infrastructure, in the open",
  description: "Report public infrastructure issues and follow a transparent path from evidence to repair."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[var(--line)] bg-white">
          <div className="page-width flex h-[72px] items-center justify-between">
            <Link href="/" className="focus-ring flex items-center gap-2 rounded-md font-bold tracking-tight">
              <span className="grid size-8 place-items-center rounded-lg bg-[var(--green)] text-white">
                <CircleCheck size={19} aria-hidden="true" />
              </span>
              <span className="text-[1.05rem]">CivicFix</span>
            </Link>
            <nav aria-label="Main navigation" className="flex items-center gap-6 text-sm font-medium text-[var(--muted)]">
              <Link className="focus-ring rounded" href="/#reports">Explore reports</Link>
              <Link className="focus-ring rounded" href="/auth">Sign in</Link>
              <Link
                href="/reports/new"
                className="focus-ring inline-flex items-center gap-2 rounded-lg bg-[var(--green)] px-4 py-2.5 font-semibold text-white hover:bg-[var(--green-dark)]"
              >
                Report an issue <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="mt-20 border-t border-[var(--line)] bg-white">
          <div className="page-width flex flex-col gap-3 py-8 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
            <p>CivicFix helps communities follow infrastructure issues from report to independent verification.</p>
            <a className="focus-ring rounded underline underline-offset-4" href="http://localhost:4000/docs" target="_blank" rel="noreferrer">
              API documentation
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
