"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink(props: { href: string; children: ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const href = props.href;

  let isActive: boolean;
  if (props.exact || href === "/") {
    isActive = pathname === href;
  } else {
    const hrefPrefix = href.endsWith("/") ? href : `${href}/`;
    isActive = pathname === href || pathname.startsWith(hrefPrefix);
  }

  return (
    <Link className="rpNavLink" href={href} aria-current={isActive ? "page" : undefined}>
      {props.children}
    </Link>
  );
}
