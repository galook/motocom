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

const rawConvexUrl = process.env.CONVEX_URL?.trim() ?? "";
const fallbackConvexUrl = "http://127.0.0.1:3210";
const resolvedConvexInternalUrl = rawConvexUrl
  ? resolveConvexUrl(rawConvexUrl)
  : fallbackConvexUrl;
const convexConfigured = rawConvexUrl.length > 0;
const devPublicHost = (process.env.DEV_PUBLIC_HOST || "moto.okbaselight.com").trim();
const defaultConvexPublicUrl = isLoopbackHostname(devPublicHost)
  ? resolvedConvexInternalUrl
  : "/convex";
const resolvedConvexPublicUrl = (process.env.CONVEX_PUBLIC_URL || defaultConvexPublicUrl).trim();

function resolveConvexModuleUrl(publicUrl: string, fallbackUrl: string, host: string): string {
  if (!publicUrl) {
    return fallbackUrl;
  }
  if (publicUrl.startsWith("http://") || publicUrl.startsWith("https://")) {
    return publicUrl;
  }
  if (publicUrl.startsWith("/")) {
    return `https://${host}${publicUrl}`;
  }
  return publicUrl;
}

function sanitizePublicConvexUrl(publicUrl: string, publicHost: string): string {
  const trimmed = publicUrl.trim();
  if (!trimmed.startsWith("http://")) {
    return trimmed;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (isLoopbackHostname(publicHost) || isLoopbackHostname(parsedUrl.hostname)) {
    return trimmed;
  }

  // For HTTPS deployments behind reverse proxy, avoid exposing insecure direct Convex URLs.
  return "/convex";
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const devServerPort = parsePort(process.env.NUXT_DEV_PORT, 3001);
const devHmrClientPort = parsePort(process.env.DEV_HMR_CLIENT_PORT, 443);
const sanitizedConvexPublicUrl = sanitizePublicConvexUrl(resolvedConvexPublicUrl, devPublicHost);
const resolvedConvexModuleUrl = resolveConvexModuleUrl(
  sanitizedConvexPublicUrl,
  resolvedConvexInternalUrl,
  devPublicHost,
);

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  devServer: {
    host: "0.0.0.0",
    port: devServerPort,
  },
  modules: ["convex-nuxt", "@vite-pwa/nuxt"],
  css: ["~/assets/css/main.css"],
  vite: {
    server: {
      allowedHosts: [
        "moto.okbaselight.com",
        "motocon.okbaselight.com",
        "motocom.okbaselight.com",
        "okbaselight.com",
        "aoo.cz",
        "moto.aoo.cz",
        "motocom.aoo.cz",
        devPublicHost,
      ],
      hmr: {
        host: devPublicHost,
        protocol: "wss",
        port: devHmrClientPort,
        clientPort: devHmrClientPort,
      },
    },
  },
  app: {
    head: {
      meta: [
        { name: "theme-color", content: "#fff8ef" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      ],
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      ],
    },
  },
  runtimeConfig: {
    public: {
      convexUrl: sanitizedConvexPublicUrl,
      convexConfigured,
    },
  },
  convex: {
    url: resolvedConvexModuleUrl,
  },
  pwa: {
    registerType: "autoUpdate",
    manifest: {
      id: "/",
      name: "MotoCom Synchronized Soundboard",
      short_name: "MotoCom",
      description: "Synchronized soundboard for group motorcycle rides.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#fff8ef",
      theme_color: "#fff8ef",
      lang: "en-US",
      icons: [
        {
          src: "/pwa-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: "/pwa-maskable-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      cleanupOutdatedCaches: true,
      globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff2}"],
    },
    devOptions: {
      enabled: false,
      suppressWarnings: true,
      type: "module",
    },
  },
});
