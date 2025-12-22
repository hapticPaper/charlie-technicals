export async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  fn: (item: TIn) => Promise<TOut>
): Promise<TOut[]> {
  if (!Number.isFinite(concurrency)) {
    throw new Error(`Invalid concurrency: ${concurrency}`);
  }

  // NOTE: If you want best-effort behavior (partial progress), ensure `fn` handles
  // per-item errors internally. Unhandled rejections will fail the whole run.
  const max = Math.max(1, Math.floor(concurrency));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }

      results[current] = await fn(items[current] as TIn);
    }
  }

  await Promise.all(Array.from({ length: Math.min(max, items.length) }, () => worker()));
  return results;
}
