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
  const { href, ...rest } = props;
  if (!href) {
    return <a {...rest} />;
  }

  if (href.startsWith("/")) {
    return <Link href={href} {...rest} />;
  }

  return <a href={href} target="_blank" rel="noopener noreferrer" {...rest} />;
}

function MdxImage(props: ComponentPropsWithoutRef<"img">) {
  const alt = props.alt ?? "";
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} />;
}
