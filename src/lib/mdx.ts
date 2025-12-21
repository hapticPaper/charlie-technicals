import { compileMDX } from "next-mdx-remote/rsc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import type { PluggableList } from "unified";

import { mdxComponents } from "../mdx/components";

const remarkPlugins: PluggableList = [remarkGfm];
const rehypePlugins: PluggableList = [rehypeSlug, [rehypeAutolinkHeadings, { behavior: "wrap" }]];

export interface RenderedMdx<TFrontmatter extends Record<string, unknown> = Record<string, unknown>> {
  content: ReactNode;
  frontmatter: TFrontmatter;
}

export async function renderMdx<TFrontmatter extends Record<string, unknown> = Record<string, unknown>>(
  source: string
): Promise<RenderedMdx<TFrontmatter>> {
  return compileMDX<TFrontmatter>({
    source,
    components: mdxComponents,
    options: {
      parseFrontmatter: true,
      mdxOptions: {
        remarkPlugins,
        rehypePlugins
      }
    }
  });
}
