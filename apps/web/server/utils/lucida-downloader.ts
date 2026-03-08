// @ts-nocheck
import path from "node:path";
import fs from "fs-extra";
import { PassThrough } from "node:stream";
import { LucidaClient } from "./lucida-client.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeFileName(input) {
  return String(input ?? "unknown").replace(/[\\/:*?"<>|]/g, "_").trim();
}

function getTrackStem(track, trackNumber, trackCount, groupedSingle) {
  if (groupedSingle) return sanitizeFileName(track.title);

  const number = trackNumber
    ? `${String(trackNumber).padStart(String(trackCount).length, "0")}. `
    : "";

  const artistPrefix = track?.artists?.[0]?.name ? `${sanitizeFileName(track.artists[0].name)} - ` : "";
  return `${number}${artistPrefix}${sanitizeFileName(track.title)}`;
}

function mapInfoToAlbum(info, token) {
  if (!info) {
    throw new Error("Metadata info is missing from Lucida payload");
  }

  if (info.type === "album") {
    const tracks = (info.tracks ?? []).map((track, index) => [index + 1, { ...track, csrf: token }]);
    return {
      title: info.title ?? "Unknown Album",
      artistName: info?.artists?.[info.artists.length - 1]?.name ?? "Unknown Artist",
      coverUrl: info?.cover_artwork?.[info.cover_artwork.length - 1]?.url ?? "",
      releaseYear: info.release_date ? new Date(info.release_date).getFullYear() : new Date().getFullYear(),
      tracks,
      trackCount: info.track_count ?? tracks.length,
    };
  }

  if (info.type === "track") {
    const album = info.album ?? {};
    const artists = album.artists ?? info.artists ?? [];

    return {
      title: album.title ?? info.title ?? "Unknown Track",
      artistName: artists?.[artists.length - 1]?.name ?? "Unknown Artist",
      coverUrl: album?.coverArtwork?.[album.coverArtwork.length - 1]?.url
        ?? album?.cover_artwork?.[album.cover_artwork.length - 1]?.url
        ?? "",
      releaseYear: album.release_date ? new Date(album.release_date).getFullYear() : new Date().getFullYear(),
      tracks: [[null, { ...info, csrf: token }]],
      trackCount: album.track_count ?? 1,
    };
  }

  throw new Error(`Unsupported payload type: ${info.type} (Full info: ${JSON.stringify(info).slice(0, 100)}...)`);
}

export class LucidaDownloader {
  constructor(options = {}) {
    this.client = new LucidaClient();
    this.options = {
      country: options.country ?? "US",
      metadata: options.metadata !== false,
      isPrivate: options.private === true,
      forceDownload: options.forceDownload === true,
      groupSingles: options.groupSingles === true,
      flattenDirectories: options.flattenDirectories === true,
      albumYear: options.albumYear ?? null,
      skipTracks: options.skipTracks === true,
      skipCover: options.skipCover === true,
      outputPath: options.outputPath,
      progress: typeof options.progress === "function" ? options.progress : () => { },
    };

    this.control = {
      isPaused: typeof options?.control?.isPaused === "function" ? options.control.isPaused : () => false,
      isCancelled: typeof options?.control?.isCancelled === "function" ? options.control.isCancelled : () => false,
    };

    this.lastProgress = 0;
  }

  progress(progress, message) {
    this.lastProgress = progress;
    this.options.progress(progress, message);
  }

  async guardControl() {
    if (this.control.isCancelled()) {
      throw new Error("Download cancelled");
    }

    if (this.control.isPaused()) {
      this.progress(this.lastProgress, "Paused");
      while (this.control.isPaused()) {
        await delay(500);
        if (this.control.isCancelled()) {
          throw new Error("Download cancelled");
        }
      }
      this.progress(this.lastProgress, "Resuming");
    }
  }

  async resolveAlbum(url) {
    await this.guardControl();
    this.progress(5, "Resolving album metadata");
    const html = await this.client.resolveItemPage(url, this.options.country);

    if (!html || typeof html !== 'string') {
      throw new Error("Empty or invalid response from Lucida");
    }

    let pageData;
    try {
      pageData = this.client.parsePageData(html);
    } catch (parseErr) {
      console.error("[LucidaDownloader] Failed to parse page data:", parseErr.message);
      console.error("[LucidaDownloader] HTML preview:", html.slice(0, 300));
      throw parseErr;
    }

    if (!pageData || typeof pageData !== 'object') {
      throw new Error("parsePageData returned invalid result");
    }

    // info may come back as a JSON string — parse it if so
    if (typeof pageData.info === 'string') {
      try {
        pageData.info = JSON.parse(pageData.info);
      } catch {
        console.error("[LucidaDownloader] pageData.info is a string but not valid JSON:", pageData.info.slice(0, 200));
        throw new Error("Lucida returned invalid metadata (string instead of object). The URL may be unsupported.");
      }
    }

    if (pageData.info && pageData.info.success === false) {
      throw new Error(pageData.info.error || "Failed to resolve metadata from Lucida");
    }

    if (!pageData.info || typeof pageData.info !== 'object') {
      console.error("[LucidaDownloader] pageData.info is missing or not an object. Keys:", Object.keys(pageData));
      throw new Error("Lucida response missing metadata info. The URL may be invalid or the service may be down.");
    }

    try {
      const album = mapInfoToAlbum(pageData.info, pageData.token);
      const groupedSingle = this.options.groupSingles && album.trackCount === 1 && album.tracks[0]?.[1]?.title === album.title;
      return { album, groupedSingle, pageData };
    } catch (err) {
      console.error("Metadata mapping failed. PageData keys:", Object.keys(pageData));
      if (pageData.info) console.error("Info type:", typeof pageData.info, "| Info keys:", Object.keys(pageData.info));
      throw err;
    }
  }

  async downloadAlbum(url) {
    const { album, groupedSingle, pageData } = await this.resolveAlbum(url);

    const albumPath = await this.createAlbumDirectory(album, groupedSingle);
    await fs.ensureDir(albumPath);

    if (!this.options.skipTracks) {
      const tracks = [...album.tracks].reverse();
      for (let i = 0; i < tracks.length; i += 1) {
        await this.guardControl();
        const [trackNumber, track] = tracks[i];
        const progressBase = 10 + Math.round((i / Math.max(tracks.length, 1)) * 80);
        const progressWeight = Math.round((1 / Math.max(tracks.length, 1)) * 80);
        this.progress(progressBase, `Downloading track ${i + 1}/${tracks.length}: ${track.title}`);

        let success = false;
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await this.downloadTrack({
              track,
              trackNumber,
              trackCount: album.trackCount,
              tokenExpiry: pageData.token_expiry,
              albumPath,
              groupedSingle,
              progressBase,
              progressWeight,
            });
            success = true;
            break;
          } catch (err) {
            lastError = err;
            if (err.message === "Download cancelled") throw err;
            this.progress(progressBase, `Retry ${attempt}/3 failed for track: ${track.title}`);
            await delay(2000);
          }
        }
        if (!success) {
          throw lastError || new Error(`Failed to download track ${track.title} after 3 attempts`);
        }
      }
    }

    if (!this.options.skipCover && album.coverUrl) {
      await this.guardControl();
      this.progress(94, "Downloading album cover");
      if (groupedSingle) {
        const trackTuple = album.tracks[0];
        const stem = getTrackStem(trackTuple[1], trackTuple[0], album.trackCount, groupedSingle);
        await this.downloadCover(album.coverUrl, path.join(albumPath, `${stem}.jpg`));
      } else {
        await this.downloadCover(album.coverUrl, path.join(albumPath, "cover.jpg"));
      }
    }

    this.progress(100, "Download completed");

    return {
      success: true,
      albumPath,
      album: {
        title: album.title,
        artist: album.artistName,
        tracks: album.trackCount,
      },
    };
  }

  async createAlbumDirectory(album, groupedSingle) {
    const artist = sanitizeFileName(album.artistName);
    let albumDir = groupedSingle ? "Singles" : sanitizeFileName(album.title);

    if (!groupedSingle && this.options.albumYear === "append") {
      albumDir = `${albumDir} (${album.releaseYear})`;
    }

    if (!groupedSingle && this.options.albumYear === "prepend") {
      albumDir = `(${album.releaseYear}) ${albumDir}`;
    }

    if (this.options.flattenDirectories) {
      return path.join(this.options.outputPath, `${artist} - ${albumDir}`);
    }

    return path.join(this.options.outputPath, artist, albumDir);
  }

  async downloadTrack({ track, trackNumber, trackCount, tokenExpiry, albumPath, groupedSingle, progressBase, progressWeight }) {
    await this.guardControl();

    const stem = getTrackStem(track, trackNumber, trackCount, groupedSingle);

    if (!this.options.forceDownload) {
      const possibleExts = ['flac', 'm4a', 'mp3', 'ogg'];
      for (const ext of possibleExts) {
        if (await fs.pathExists(path.join(albumPath, `${stem}.${ext}`))) {
          if (progressBase !== undefined && progressWeight !== undefined) {
            this.progress(progressBase + progressWeight, `Skipped existing track: ${track.title}`);
          }
          return;
        }
      }
    }

    const handoff = await this.client.requestTrackHandoff({
      country: this.options.country,
      metadata: this.options.metadata,
      isPrivate: this.options.isPrivate,
      tokenExpiry,
      csrf: track.csrf,
      csrfFallback: track.csrf_fallback,
      url: track.url,
    });

    await this.waitForHandoff(handoff);

    const response = await this.client.downloadRequestFile(handoff);
    const contentType = response.headers['content-type'] || '';
    let ext = 'flac';
    if (contentType.includes('mp4') || contentType.includes('m4a')) ext = 'm4a';
    else if (contentType.includes('mpeg') || contentType.includes('mp3')) ext = 'mp3';
    else if (contentType.includes('ogg')) ext = 'ogg';

    const targetPath = path.join(albumPath, `${stem}.${ext}`);
    const tempPath = `${targetPath}.part`;

    const totalBytes = Number(response.headers['content-length']) || 0;

    await new Promise((resolve, reject) => {
      let downloadedBytes = 0;
      let lastUpdate = 0;
      const writer = fs.createWriteStream(tempPath);
      const monitor = new PassThrough();

      monitor.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (now - lastUpdate > 500 && totalBytes > 0 && progressBase !== undefined && progressWeight !== undefined) {
          lastUpdate = now;
          const trackProgressRatio = downloadedBytes / totalBytes;
          const currentProgress = progressBase + Math.round(trackProgressRatio * progressWeight);
          const mbDownloaded = (downloadedBytes / 1024 / 1024).toFixed(1);
          const mbTotal = (totalBytes / 1024 / 1024).toFixed(1);
          this.progress(currentProgress, `Downloading track: ${track.title} (${mbDownloaded}MB / ${mbTotal}MB)`);
        }
      });

      response.data.pipe(monitor).pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
      monitor.on("error", reject);
    });

    await this.validateAudioFile(tempPath, ext);
    await fs.move(tempPath, targetPath, { overwrite: true });
  }

  async validateAudioFile(filePath, ext) {
    const fd = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(12);
      const { bytesRead } = await fs.read(fd, buffer, 0, 12, 0);
      if (bytesRead < 4) throw new Error("File too small to be a valid audio format");

      const hex = buffer.toString('hex', 0, 4);
      const str = buffer.toString('utf8', 0, 4);

      if (ext === 'flac') {
        if (str !== 'fLaC') throw new Error(`Invalid FLAC signature: ${str}`);
      } else if (ext === 'mp3') {
        // ID3 or \xff\xfb (MPEG ADTS) or \xff\xfa
        const isId3 = str.startsWith('ID3');
        const isAdts = hex.startsWith('fffb') || hex.startsWith('fffa') || hex.startsWith('ffe3');
        if (!isId3 && !isAdts) throw new Error(`Invalid MP3 signature: ${hex}`);
      } else if (ext === 'm4a') {
        // usually ftyp at offset 4
        const ftyp = buffer.toString('utf8', 4, 8);
        if (ftyp !== 'ftyp') throw new Error(`Invalid M4A signature (missing ftyp): ${ftyp}`);
      } else if (ext === 'ogg') {
        if (str !== 'OggS') throw new Error(`Invalid OGG signature: ${str}`);
      }
    } finally {
      await fs.close(fd);
    }
  }

  async waitForHandoff(handoff) {
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.guardControl();
      const status = await this.client.getRequestStatus(handoff);
      if (status.status === "completed") return;
      if (status.status === "error") {
        throw new Error(status.message ?? "Track request failed");
      }
      await delay(1000);
    }

    throw new Error("Timed out while waiting for track request");
  }

  async downloadCover(url, targetPath) {
    await this.guardControl();
    if (!this.options.forceDownload && await fs.pathExists(targetPath)) {
      return;
    }

    const cleanUrl = url.includes("qobuz") ? url.replace(/_[^_]+\.jpg$/i, "_org.jpg") : url;
    const response = await fetch(cleanUrl);
    if (!response.ok) throw new Error("Failed to download cover art");

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(targetPath, buffer);
  }
}
