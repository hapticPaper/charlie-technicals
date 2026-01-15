import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { renderMdx } from "../../../lib/mdx";
import { parseIsoDateYmd } from "../../../market/date";
import {
  getSetupReviewMdxPath,
  getSetupReviewsDir,
  listSetupReviewPerformancesForDate
} from "../../../market/setupReviewStorage";
import type { SetupReviewPerformance } from "../../../market/types";

import styles from "./setupReview.module.css";

type SetupReviewPageParams = { date: string };
type SetupReviewPageProps = { params: SetupReviewPageParams | PromiseLike<SetupReviewPageParams> };

async function resolveAndValidateParams(params: SetupReviewPageProps["params"]): Promise<SetupReviewPageParams> {
  const resolved = await params;

  const date = (resolved as { date?: unknown })?.date;
  if (typeof date !== "string") {
    notFound();
  }

  try {
    parseIsoDateYmd(date);
  } catch {
    notFound();
  }

  return { date };
}

export async function generateStaticParams() {
  const root = getSetupReviewsDir();

  let entries: Dirent[] = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".mdx"))
    .map((e) => e.name.replace(/\.mdx$/, ""))
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
    .map((date) => ({ date }));
}

function formatSignedPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function pnlPctFor(perf: SetupReviewPerformance): number | null {
  if (perf.status === "closed") {
    return perf.realizedPct;
  }

  return perf.totalPct;
}

function renderRows(rows: SetupReviewPerformance[]) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Opened</th>
            <th>Hit SL</th>
            <th>Hit TP1</th>
            <th>Hit both TP</th>
            <th>Performance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const opened = Boolean(p.openedAt);
            const hitSl = Boolean(p.stopAt);
            const hitTp1 = Boolean(p.tp1At);
            const hitTp2 = Boolean(p.tp2At);
            const pnlPct = pnlPctFor(p);
            const pnlLabel = pnlPct == null ? "--" : formatSignedPct(pnlPct);
            const pnlClass =
              pnlPct == null
                ? styles.pnlNeutral
                : pnlPct > 0
                  ? styles.pnlPositive
                  : pnlPct < 0
                    ? styles.pnlNegative
                    : styles.pnlNeutral;

            return (
              <tr key={p.symbol}>
                <td>
                  <strong>{p.symbol}</strong>
                </td>
                <td>{p.trade.side.toUpperCase()}</td>
                <td>{opened ? "Yes" : "No"}</td>
                <td>{hitSl ? "Yes" : "No"}</td>
                <td>{hitTp1 ? "Yes" : "No"}</td>
                <td>{hitTp1 && hitTp2 ? "Yes" : "No"}</td>
                <td className={pnlClass}>{pnlLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function SetupReviewPage(props: SetupReviewPageProps) {
  const { date } = await resolveAndValidateParams(props.params);
  const mdxPath = getSetupReviewMdxPath(date);

  let mdxRaw: string;
  try {
    mdxRaw = await readFile(mdxPath, "utf8");
  } catch {
    notFound();
  }

  const performances = (await listSetupReviewPerformancesForDate(date))
    .map((p) => p.performance)
    .filter((p) => p.status === "open")
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  let content: ReactNode;
  try {
    const res = await renderMdx(mdxRaw, {
      SetupReviewDay: () => {
        if (performances.length === 0) {
          return <p className="report-muted">No open positions for {date}.</p>;
        }

        return renderRows(performances);
      }
    });
    content = res.content;
  } catch {
    notFound();
  }

  return (
    <>
      <div className={styles.header}>
        <div>
          <h1>Setup reviews ({date})</h1>
          <p className="report-muted">Only open positions are tracked on this page.</p>
        </div>
        <div className={styles.links}>
          <Link className="rpToolbarButton rpToolbarButtonSecondary" href={`/reports/${date}`}>
            View report
          </Link>
          <Link className="rpToolbarButton" href="/portfolio">
            Portfolio
          </Link>
        </div>
      </div>
      {content}
    </>
  );
}
