import { compileMDX } from "next-mdx-remote/rsc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import type { PluggableList } from "unified";

import { baseMdxComponents } from "../mdx/components";

const remarkPlugins: PluggableList = [remarkGfm];
const rehypePlugins: PluggableList = [rehypeSlug, [rehypeAutolinkHeadings, { behavior: "wrap" }]];

export interface RenderedMdx<TFrontmatter extends Record<string, unknown> = Record<string, unknown>> {
  content: ReactNode;
  frontmatter: TFrontmatter;
}

type ComponentOverrides = Parameters<typeof compileMDX<Record<string, unknown>>>[0]["components"];

function ensureObjectFrontmatter(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error("MDX frontmatter must be an object");
}

export async function renderMdx<TFrontmatter extends Record<string, unknown> = Record<string, unknown>>(
  source: string,
  overrides?: ComponentOverrides
): Promise<RenderedMdx<TFrontmatter>> {
  const result = await compileMDX<TFrontmatter>({
    source,
    components: overrides ? { ...baseMdxComponents, ...overrides } : baseMdxComponents,
    options: {
      parseFrontmatter: true,
      mdxOptions: {
        remarkPlugins,
        rehypePlugins
      }
    }
  });

  return {
    content: result.content,
    frontmatter: ensureObjectFrontmatter(result.frontmatter) as TFrontmatter
  };
}
