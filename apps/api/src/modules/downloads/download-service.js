import fs from "fs-extra";
import { env } from "../../config/env.js";
import { LucidaDownloader } from "../../scraper/lucida-downloader.js";
import { BakaScraper } from "../../scraper/baka.js";
import { createJob, getJob, listJobs, updateJob, updateJobControl, cleanupJobs } from "./download-store.js";
import { buildAlbumDetail, buildLibrarySnapshot } from "../files/library-cache.js";

function normalizeOptions(options = {}) {
  return {
    country: options.country ?? env.defaultCountry,
    metadata: options.metadata !== false,
    private: options.private === true,
    forceDownload: options.forceDownload === true,
    groupSingles: options.groupSingles === true,
    flattenDirectories: options.flattenDirectories === true,
    albumYear: options.albumYear ?? null,
    skipTracks: options.skipTracks === true,
    skipCover: options.skipCover === true,
    baka: options.baka === true,
  };
}

/**
 * Normalize streaming service URLs to their canonical form.
 * Many services have multiple URL variants (www, http, listen.*, etc.)
 * but Lucida may only recognize the canonical form.
 */
function normalizeServiceUrl(url) {
  if (!url) return url;
  let normalized = url.trim();

  // Ensure https
  normalized = normalized.replace(/^http:\/\//i, 'https://');

  // Tidal: normalize www.tidal.com and listen.tidal.com to tidal.com
  normalized = normalized.replace(/^https:\/\/(?:www\.|listen\.)?tidal\.com/i, 'https://tidal.com');

  // Deezer: normalize www.deezer.com to deezer.com
  normalized = normalized.replace(/^https:\/\/www\.deezer\.com/i, 'https://deezer.com');

  // Soundcloud: normalize www.soundcloud.com to soundcloud.com
  normalized = normalized.replace(/^https:\/\/www\.soundcloud\.com/i, 'https://soundcloud.com');

  // Qobuz: normalize www variants
  normalized = normalized.replace(/^https:\/\/www\.(open\.qobuz\.com)/i, 'https://$1');

  return normalized;
}

export class DownloadService {
  constructor({ consoleService } = {}) {
    fs.ensureDirSync(env.downloadsDir);
    this.libraryCache = new Map();
    this.albumDetailCache = new Map();
    this.consoleService = consoleService ?? null;
    this.progressThrottle = new Map();
  }

  emitConsole(event) {
    if (!this.consoleService) return;
    this.consoleService.emit(event);
  }

  startDownload({ url, options }) {
    let normalizedUrl = normalizeServiceUrl(url);
    if (normalizedUrl && !normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    const id = String(Date.now());
    const mergedOptions = normalizeOptions(options);
    createJob({ id, url: normalizedUrl, options: mergedOptions });

    this.emitConsole({
      type: "DOWNLOAD_START",
      category: "Downloads",
      level: "info",
      message: `Download queued ${id} ${url}`,
      data: { id, url },
    });

    void this.runJob(id, url, mergedOptions);

    return getJob(id);
  }

  async runJob(id, url, options) {
    const initial = getJob(id);
    if (!initial) return;
    if (initial.control?.cancelled) {
      updateJob(id, {
        status: "cancelled",
        message: "Cancelled by user",
        error: null,
        finishedAt: Date.now(),
      });
      return;
    }

    const paused = initial.control?.paused === true;
    updateJob(id, {
      status: paused ? "paused" : "processing",
      progress: 5,
      message: paused ? "Paused by user" : "Initializing downloader",
      startedAt: Date.now(),
    });

    try {
      let result;
      if (options.baka) {
        const baka = new BakaScraper();
        const bakaResult = await baka.download(url, env.downloadsDir, {
          ...options,
          onProgress: (progress, message) => {
            updateJob(id, { progress, message });
            this.emitConsole({
              type: "DOWNLOAD_PROGRESS",
              category: "Downloads",
              level: "info",
              message: `${id} ${progress}% ${message}`,
              data: { id, progress, message },
            });
          }
        });
        result = bakaResult;
      } else {
        const downloader = new LucidaDownloader({
          ...options,
          outputPath: env.downloadsDir,
          progress: (progress, message) => {
            // Extract track info from message like "Downloading track 1/2: Track Name"
            const trackMatch = message.match(/track (\d+)\/(\d+):\s*(.+?)(?:\s*\(|$)/i);
            const jobPatch = { progress, message };
            if (trackMatch) {
              jobPatch.trackInfo = {
                current: parseInt(trackMatch[1], 10),
                total: parseInt(trackMatch[2], 10),
                name: trackMatch[3].trim(),
              };
            }
            updateJob(id, jobPatch);
            const now = Date.now();
            const last = this.progressThrottle.get(id) ?? 0;
            if (now - last > 1000 || progress >= 100) {
              this.progressThrottle.set(id, now);
              this.emitConsole({
                type: "DOWNLOAD_PROGRESS",
                category: "Downloads",
                level: "info",
                message: `${id} ${progress}% ${message}`,
                data: { id, progress, message },
              });
            }
          },
          control: {
            isPaused: () => {
              const job = getJob(id);
              return job?.control?.paused === true;
            },
            isCancelled: () => {
              const job = getJob(id);
              return job?.control?.cancelled === true;
            },
          },
        });

        result = await downloader.downloadAlbum(url);
      }

      updateJob(id, {
        status: "completed",
        progress: 100,
        message: options.baka ? "Download completed via Baka" : "Download completed",
        result,
        finishedAt: Date.now(),
      });
      this.progressThrottle.delete(id);
      this.emitConsole({
        type: "DOWNLOAD_COMPLETE",
        category: "Downloads",
        level: "success",
        message: `Download completed ${id}`,
        data: { id, result },
      });
    } catch (error) {
      const message = error?.message ?? "Download failed";
      if (message === "Download cancelled") {
        updateJob(id, {
          status: "cancelled",
          message: "Cancelled by user",
          error: null,
          finishedAt: Date.now(),
        });
        this.progressThrottle.delete(id);
        this.emitConsole({
          type: "DOWNLOAD_COMPLETE",
          category: "Downloads",
          level: "warning",
          message: `Download cancelled ${id}`,
          data: { id },
        });
      } else {
        updateJob(id, {
          status: "error",
          message,
          error: message,
          finishedAt: Date.now(),
        });
        this.progressThrottle.delete(id);
        this.emitConsole({
          type: "ERROR",
          category: "Errors",
          level: "error",
          message: `Download error ${id}: ${message}`,
          data: { id, error: message },
        });
      }
    }
  }

  getById(id) {
    return getJob(id);
  }

  list() {
    return listJobs();
  }

  cleanup(maxAgeMs) {
    return cleanupJobs(maxAgeMs);
  }

  async listDownloadsTree() {
    return buildLibrarySnapshot(env.downloadsDir, this.libraryCache);
  }

  async getAlbumDetail(artist, album) {
    return buildAlbumDetail(env.downloadsDir, this.albumDetailCache, artist, album);
  }

  pause(id) {
    const job = getJob(id);
    if (!job) return null;

    updateJobControl(id, { paused: true });
    updateJob(id, { status: "paused", message: "Paused by user" });
    this.emitConsole({
      type: "DOWNLOAD_PAUSED",
      category: "Downloads",
      level: "warning",
      message: `Paused ${id}`,
      data: { id },
    });
    return getJob(id);
  }

  resume(id) {
    const job = getJob(id);
    if (!job) return null;

    updateJobControl(id, { paused: false });
    updateJob(id, { status: "processing", message: "Resumed" });
    this.emitConsole({
      type: "DOWNLOAD_RESUMED",
      category: "Downloads",
      level: "info",
      message: `Resumed ${id}`,
      data: { id },
    });
    return getJob(id);
  }

  cancel(id) {
    const job = getJob(id);
    if (!job) return null;

    updateJobControl(id, { cancelled: true, paused: false });
    updateJob(id, { status: "cancelled", message: "Cancelling download" });
    this.emitConsole({
      type: "DOWNLOAD_CANCEL",
      category: "Downloads",
      level: "warning",
      message: `Cancelling ${id}`,
      data: { id },
    });
    return getJob(id);
  }

  retry(id) {
    const job = getJob(id);
    if (!job) return null;
    if (!["error", "cancelled"].includes(job.status)) return job;

    updateJobControl(id, { cancelled: false, paused: false });
    updateJob(id, {
      status: "processing",
      progress: 5,
      message: "Retrying download",
      error: null,
      finishedAt: null,
      startedAt: Date.now(),
    });
    this.emitConsole({
      type: "DOWNLOAD_RETRY",
      category: "Downloads",
      level: "info",
      message: `Retrying ${id}`,
      data: { id },
    });

    void this.runJob(id, job.url, job.options);
    return getJob(id);
  }

  getStatusSummary() {
    const jobs = listJobs();
    const active = jobs.filter((job) => !["completed", "error", "cancelled"].includes(job.status)).length;
    return {
      backend: "Online",
      scraper: "Running",
      queue: `${active} jobs`,
      activeJobs: active,
      totalJobs: jobs.length,
    };
  }
}
