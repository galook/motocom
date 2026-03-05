export const DEFAULT_MUTATION_TIMEOUT_MS = 10_000;

export interface RunMutationOptions {
  timeoutMs?: number;
  operationName?: string;
  convexUrl?: string;
  clientHost?: string;
}

const FALLBACK_TIMEOUT_ERROR =
  "Request timed out. Check your network connection and Convex URL, then try again.";

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function getClientHost(overrideHost?: string): string | null {
  if (overrideHost && overrideHost.trim()) {
    return overrideHost.trim();
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.location.hostname || null;
}

export function buildConnectivityHint(
  convexUrl?: string,
  clientHostOverride?: string,
): string | null {
  if (!convexUrl) {
    return null;
  }

  let parsedConvexUrl: URL;
  try {
    parsedConvexUrl = new URL(convexUrl);
  } catch {
    return null;
  }

  const clientHost = getClientHost(clientHostOverride);
  if (!clientHost) {
    return null;
  }

  if (!isLoopbackHost(parsedConvexUrl.hostname) || isLoopbackHost(clientHost)) {
    return null;
  }

  const suggestedUrl = `${parsedConvexUrl.protocol}//${clientHost}${parsedConvexUrl.port ? `:${parsedConvexUrl.port}` : ""}`;

  return (
    `This device opened the app from "${clientHost}", ` +
    `but Convex is configured as "${convexUrl}", which points to this phone's own loopback interface. ` +
    `Set CONVEX_URL to a LAN-reachable address (for example "${suggestedUrl}") and restart Nuxt + Convex.`
  );
}

function buildTimeoutMessage(
  timeoutMs: number,
  options?: RunMutationOptions,
): string {
  const operation = options?.operationName?.trim() || "Request";
  const hint = buildConnectivityHint(options?.convexUrl, options?.clientHost);
  return hint
    ? `${operation} timed out after ${timeoutMs}ms. ${hint}`
    : `${operation} timed out after ${timeoutMs}ms. ${FALLBACK_TIMEOUT_ERROR}`;
}

export function rewriteLoopbackUrlForClient(
  rawUrl: string,
  clientHostOverride?: string,
): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const clientHost = getClientHost(clientHostOverride);
  if (!clientHost || isLoopbackHost(clientHost) || !isLoopbackHost(parsedUrl.hostname)) {
    return rawUrl;
  }

  parsedUrl.hostname = clientHost;
  return parsedUrl.toString();
}

export async function runMutation<TInput, TOutput>(
  mutate: (args: TInput) => Promise<unknown>,
  args: TInput,
  options?: RunMutationOptions,
): Promise<TOutput> {
  const timeoutMs = Math.max(1, options?.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(buildTimeoutMessage(timeoutMs, options)));
    }, timeoutMs);
  });

  const output = await Promise.race([mutate(args), timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  });

  if (
    output &&
    typeof output === "object" &&
    ("result" in output || "error" in output)
  ) {
    const wrapped = output as { result?: TOutput; error?: unknown };
    if (wrapped.error) {
      throw wrapped.error;
    }
    return wrapped.result as TOutput;
  }

  return output as TOutput;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return "Unexpected error";
}
