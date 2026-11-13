import "server-only";
import { isRetryableStatus, retryDelayMs } from "@/domain/squareSync";

/**
 * Shared Square REST transport: host selection (production/sandbox), the
 * pinned API version, and retry with backoff on 429/5xx (Retry-After honored).
 */

export const SQUARE_VERSION = "2025-10-16";

export type SquareEnvironment = "production" | "sandbox";

/** What an API call needs: a token and which Square environment it belongs to. */
export interface SquareClient {
  accessToken: string;
  environment: SquareEnvironment;
  /** Locations whose orders and timecards we read. */
  locationIds: string[];
}

export const squareHost = (environment: SquareEnvironment) =>
  environment === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";

export class SquareError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "SquareError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Low-level request with retries. `path` starts with "/" and includes "/v2" or "/oauth2". */
export async function squareRequest<T>(
  environment: SquareEnvironment,
  path: string,
  init: RequestInit & { authorization?: string } = {},
  attempts = 4,
): Promise<T> {
  const { authorization, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${squareHost(environment)}${path}`, {
        ...rest,
        headers: {
          ...(authorization ? { Authorization: authorization } : {}),
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...rest.headers,
        },
        cache: "no-store",
        signal: rest.signal ?? AbortSignal.timeout(20_000),
      });
    } catch (e) {
      lastErr = new SquareError(`Couldn't reach Square (${(e as Error).message || "network error"}).`, 0, "NETWORK");
      if (attempt < attempts) {
        await sleep(retryDelayMs(attempt, null));
        continue;
      }
      throw lastErr;
    }
    if (isRetryableStatus(res.status) && attempt < attempts) {
      await sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as { errors?: { code?: string; detail?: string }[]; message?: string; type?: string };
    if (!res.ok) {
      const detail = body.errors?.map((e) => e.detail || e.code).filter(Boolean).join("; ") || body.message || res.statusText;
      throw new SquareError(`Square ${res.status}: ${detail}`, res.status, body.errors?.[0]?.code ?? body.type);
    }
    return body as T;
  }
  throw lastErr ?? new SquareError("Square request failed.", 0);
}

/** Authenticated /v2 call for a connected account. */
export function squareCall<T>(client: Pick<SquareClient, "accessToken" | "environment">, path: string, init: RequestInit = {}): Promise<T> {
  return squareRequest<T>(client.environment, `/v2${path}`, { ...init, authorization: `Bearer ${client.accessToken}` });
}

/** Plain-English version of a Square failure for the UI. */
export function friendlySquareError(e: unknown): string {
  if (e instanceof SquareError) {
    if (e.status === 401) return "Square didn't accept that access token. Check it was copied in full and is for the right environment (production vs sandbox).";
    if (e.status === 403) return "That Square token is missing a permission this app needs. Reconnect and approve all the requested permissions.";
    if (e.status === 429) return "Square is rate-limiting us right now. Try again in a minute.";
    if (e.status === 0) return "Couldn't reach Square. Check the internet connection and try again.";
    if (e.status >= 500) return "Square is having trouble right now. Try again in a few minutes.";
    return e.message;
  }
  return (e as Error)?.message || "Something went wrong talking to Square.";
}
