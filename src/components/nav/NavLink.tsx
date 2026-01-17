"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink(props: { href: string; children: ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const isActive = props.exact ? pathname === props.href : pathname.startsWith(props.href);

  return (
    <Link className="rpNavLink" href={props.href} aria-current={isActive ? "page" : undefined}>
      {props.children}
    </Link>
  );
}
