"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink(props: { href: string; children: ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const href = props.href;
  const hrefPrefix = href.endsWith("/") ? href : `${href}/`;
  const isActive = props.exact ? pathname === href : pathname === href || pathname.startsWith(hrefPrefix);

  return (
    <Link className="rpNavLink" href={href} aria-current={isActive ? "page" : undefined}>
      {props.children}
    </Link>
  );
}
