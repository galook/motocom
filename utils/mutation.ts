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

function getClientOrigin(overrideOrigin?: string): string | null {
  if (overrideOrigin && overrideOrigin.trim()) {
    return overrideOrigin.trim();
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.location.origin || null;
}

function getClientProtocol(overrideOrigin?: string): string | null {
  const clientOrigin = getClientOrigin(overrideOrigin);
  if (!clientOrigin) {
    return null;
  }
  try {
    return new URL(clientOrigin).protocol;
  } catch {
    return null;
  }
}

function getRuntimeConvexPublicUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const runtimeConfig = (window as Window & {
    __NUXT__?: {
      config?: {
        public?: {
          convexUrl?: unknown;
        };
      };
    };
  }).__NUXT__?.config;

  const candidate = runtimeConfig?.public?.convexUrl;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function resolveClientConvexBaseUrl(
  convexUrlOverride?: string,
  clientOriginOverride?: string,
): URL | null {
  const candidateConvexUrl = convexUrlOverride?.trim() || getRuntimeConvexPublicUrl();
  if (!candidateConvexUrl) {
    return null;
  }

  try {
    if (candidateConvexUrl.startsWith("/")) {
      const clientOrigin = getClientOrigin(clientOriginOverride);
      if (!clientOrigin) {
        return null;
      }
      return new URL(candidateConvexUrl, clientOrigin);
    }
    return new URL(candidateConvexUrl);
  } catch {
    return null;
  }
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
  convexUrlOverride?: string,
  clientOriginOverride?: string,
): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }

  let rewrittenUrl: URL;
  try {
    rewrittenUrl = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const clientHost = getClientHost(clientHostOverride);
  if (clientHost && !isLoopbackHost(clientHost) && isLoopbackHost(rewrittenUrl.hostname)) {
    rewrittenUrl.hostname = clientHost;
  }

  const clientProtocol = getClientProtocol(clientOriginOverride);
  if (clientProtocol === "https:" && rewrittenUrl.protocol === "http:") {
    const convexBaseUrl = resolveClientConvexBaseUrl(convexUrlOverride, clientOriginOverride);
    if (convexBaseUrl && rewrittenUrl.pathname.startsWith("/api/")) {
      if (convexBaseUrl.protocol === "http:") {
        convexBaseUrl.protocol = "https:";
      }
      const convexBasePath = convexBaseUrl.pathname.replace(/\/$/, "");
      const mergedPath = `${convexBasePath}${rewrittenUrl.pathname}` || rewrittenUrl.pathname;
      return `${convexBaseUrl.origin}${mergedPath}${rewrittenUrl.search}${rewrittenUrl.hash}`;
    }

    if (clientHost && rewrittenUrl.hostname === clientHost) {
      rewrittenUrl.protocol = "https:";
      if (rewrittenUrl.port === "80") {
        rewrittenUrl.port = "";
      }
    }
  }

  return rewrittenUrl.toString();
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
