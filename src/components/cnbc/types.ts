export type CnbcVideoCard = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  /**
   * Normalized, non-empty topic label used for grouping and display.
   *
   * Prefer constructing cards via `toCnbcVideoCard()` to keep this stable.
   */
  topic: string;
  symbol: string | null;
};
