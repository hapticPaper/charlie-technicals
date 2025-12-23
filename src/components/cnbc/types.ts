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

/** Canonical YYYY-MM-DD date key used for CNBC video aggregations. */
export type CnbcDateKey = string;

/** Normalized topic label key used for grouping and display. */
export type CnbcTopicKey = string;

/**
* Maps a normalized topic key to the available video cards for that topic.
*/
export type CnbcVideosByTopic = Record<CnbcTopicKey, CnbcVideoCard[]>;

/**
* Maps a YYYY-MM-DD date to the available video cards for each normalized topic on that day.
*/
export type CnbcVideosByDate = Record<CnbcDateKey, CnbcVideosByTopic>;
