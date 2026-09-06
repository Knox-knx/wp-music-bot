// codes by: @LouisPy
export async function withRetry(asyncFn, {
  maxAttempts = 3,
  backoffBase = 500,
  maxDelay = 30_000,
  shouldRetry = (err) => {
    const status = err?.response?.status;
    return status === 429 || (status ?? 0) >= 500;
  },
}) {
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await asyncFn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1 && shouldRetry(err)) {
        const delay = Math.min(backoffBase * 2 ** attempt, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}