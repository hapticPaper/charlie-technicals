import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

export const baseMdxComponents = {
  a: MdxLink,
  img: MdxImage
};

function MdxLink(props: ComponentPropsWithoutRef<"a">) {
  const { href, children, ...rest } = props;
  if (!href) {
    return <a {...rest}>{children}</a>;
  }

  if (href.startsWith("#")) {
    return <a {...rest} href={href}>{children}</a>;
  }

  if (href.startsWith("/")) {
    const linkSafeRest = { ...rest };
    delete (linkSafeRest as { target?: unknown }).target;
    delete (linkSafeRest as { rel?: unknown }).rel;
    return (
      <Link href={href} {...linkSafeRest}>
        {children}
      </Link>
    );
  }

  return (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function MdxImage(props: ComponentPropsWithoutRef<"img">) {
  const { alt = "", loading, ...rest } = props;

  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} loading={loading ?? "lazy"} {...rest} />;
}
