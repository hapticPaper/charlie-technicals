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
  const { href, children, ...rest } = props;
  if (!href) {
    return <a {...rest}>{children}</a>;
  }

  if (href.startsWith("/")) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

function MdxImage(props: ComponentPropsWithoutRef<"img">) {
  const alt = props.alt ?? "";

  if (process.env.NODE_ENV !== "production" && !props.alt) {
    console.warn("MDX image is missing alt text", props.src);
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt} />;
}
