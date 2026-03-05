import { networkInterfaces } from "node:os";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith("10.")) {
    return true;
  }
  if (address.startsWith("192.168.")) {
    return true;
  }
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return false;
  }
  return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
}

function getPreferredLanAddress(): string | null {
  const interfaces = networkInterfaces();
  const privateCandidates: string[] = [];
  const publicCandidates: string[] = [];

  for (const records of Object.values(interfaces)) {
    for (const record of records ?? []) {
      if (record.family !== "IPv4" || record.internal) {
        continue;
      }
      if (isPrivateIpv4(record.address)) {
        privateCandidates.push(record.address);
      } else {
        publicCandidates.push(record.address);
      }
    }
  }

  return privateCandidates[0] ?? publicCandidates[0] ?? null;
}

function normalizeConvexUrl(url: URL): string {
  const normalized = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  if (normalized.endsWith("/") && !url.search && !url.hash && url.pathname === "/") {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function resolveConvexUrl(rawUrl?: string): string {
  if (!rawUrl) {
    return "";
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (!isLoopbackHostname(parsedUrl.hostname)) {
    return normalizeConvexUrl(parsedUrl);
  }

  const lanAddress = getPreferredLanAddress();
  if (!lanAddress) {
    return normalizeConvexUrl(parsedUrl);
  }

  parsedUrl.hostname = lanAddress;
  return normalizeConvexUrl(parsedUrl);
}

const resolvedConvexUrl = resolveConvexUrl(process.env.CONVEX_URL);

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: ["convex-nuxt"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    public: {
      convexUrl: resolvedConvexUrl,
    },
  },
  convex: {
    url: resolvedConvexUrl,
  },
});
