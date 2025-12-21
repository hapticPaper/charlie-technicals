import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

import { ReportCharts } from "../components/report/ReportCharts";
import { ReportSummary } from "../components/report/ReportSummary";

export const mdxComponents = {
  a: MdxLink,
  img: MdxImage,
  ReportSummary,
  ReportCharts
};

function MdxLink(props: ComponentPropsWithoutRef<"a">) {
  const href = props.href;
  if (!href) {
    return <a {...props} />;
  }

  if (href.startsWith("/")) {
    return <Link href={href} {...props} />;
  }

  return <a target="_blank" rel="noreferrer" {...props} />;
}

function MdxImage(props: ComponentPropsWithoutRef<"img">) {
  const alt = props.alt ?? "";
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} />;
}
