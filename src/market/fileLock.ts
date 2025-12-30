import { mkdir, rm } from "node:fs/promises";

export async function withFileLock<T>(
  args: { filePath: string; logPrefix: string },
  fn: () => Promise<T>
): Promise<T> {
  const lockPath = `${args.filePath}.lock`;
  const start = Date.now();
  const timeoutMs = 5000;

  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;

      if (code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - start > timeoutMs) {
        console.error(
          `[${args.logPrefix}] Lock timeout for ${args.filePath}; possible stale lock at ${lockPath}`
        );
        throw new Error(`Timed out acquiring lock for ${args.filePath}`);
      }

      await new Promise((r) => setTimeout(r, 25));
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
