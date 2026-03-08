import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const rootDir = path.resolve(process.cwd(), "apps/api");

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  lucidaBaseUrl: process.env.LUCIDA_BASE_URL ?? "https://lucida.to",
  defaultCountry: process.env.LUCIDA_DEFAULT_COUNTRY ?? "US",
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30000),
  downloadsDir: path.resolve(rootDir, process.env.DOWNLOADS_DIR ?? "downloads"),
  metadataUserAgent: process.env.METADATA_USER_AGENT ?? "LucidaStudio/2.0 (mailto:admin@example.com)",
  metadataCacheTtlMs: Number(process.env.METADATA_CACHE_TTL_MS ?? 1000 * 60 * 60 * 12),
  lastFmApiKey: process.env.LASTFM_API_KEY ?? "",
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? "",
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
  soundcloudOauthToken: process.env.SOUNDCLOUD_OAUTH_TOKEN ?? "",
  tidalAccessToken: process.env.TIDAL_ACCESS_TOKEN ?? "",
  tidalTvToken: process.env.TIDAL_TV_TOKEN ?? "",
  tidalTvSecret: process.env.TIDAL_TV_SECRET ?? "",
  deezerArl: process.env.DEEZER_ARL ?? "",
  qobuzAppId: process.env.QOBUZ_APP_ID ?? "",
  qobuzAppSecret: process.env.QOBUZ_APP_SECRET ?? "",
  yandexMusicToken: process.env.YANDEX_MUSIC_TOKEN ?? "",
};

export const isDev = env.nodeEnv !== "production";
