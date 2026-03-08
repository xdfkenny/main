import fs from 'fs-extra';
import path from 'path';
import { pipeline } from 'stream/promises';
import Lucida from 'lucida';
import SoundCloud from 'lucida/streamers/soundcloud/main.js';
import Tidal from 'lucida/streamers/tidal/main.js';
import Deezer from 'lucida/streamers/deezer/main.js';
import Qobuz from 'lucida/streamers/qobuz/main.js';
import Yandex from 'lucida-module-yandex';
import { env } from '../config/env.js';
import { embedCoverArt } from '../utils/metadata-utils.js';

function sanitizeFileName(input) {
  return String(input ?? "unknown").replace(/[\\/:*?"<>|]/g, "_").trim();
}

export class BakaScraper {
  constructor() {
    this.lucida = new Lucida({
      modules: {
        soundcloud: new SoundCloud({
          oauthToken: env.soundcloudOauthToken || undefined
        }),
        tidal: new Tidal({
          accessToken: env.tidalAccessToken || undefined,
          tvToken: env.tidalTvToken || undefined,
          tvSecret: env.tidalTvSecret || undefined
        }),
        deezer: new Deezer({
          arl: env.deezerArl || undefined
        }),
        qobuz: new Qobuz({
          appId: env.qobuzAppId || undefined,
          appSecret: env.qobuzAppSecret || undefined
        }),
        yandex: new Yandex({
          token: env.yandexMusicToken || undefined
        })
      }
    });
  }

  /**
   * Search across all configured modules concurrently
   */
  async search(query, service = 'all', limit = 20) {
    const availableServices = Object.keys(this.lucida.modules);
    let targetServices = [];

    if (service && service.toLowerCase() !== 'all') {
      const normalized = service.toLowerCase();
      if (availableServices.includes(normalized)) {
        targetServices = [normalized];
      } else {
        targetServices = availableServices;
      }
    } else {
      targetServices = availableServices;
    }

    const searchPromises = targetServices.map(async (svc) => {
      try {
        const results = await this.lucida.modules[svc].search(query, limit);

        return (results?.tracks || []).map(track => {
          let coverUrl = '';
          if (track.pictures && track.pictures.length > 0) {
            const pic = track.pictures[track.pictures.length - 1];
            coverUrl = typeof pic === 'string' ? pic : (pic.url || '');
          } else if (track.coverArtwork) {
            if (Array.isArray(track.coverArtwork) && track.coverArtwork.length > 0) {
              const lastArt = track.coverArtwork[track.coverArtwork.length - 1];
              coverUrl = typeof lastArt === 'string' ? lastArt : (lastArt.url || '');
            } else if (typeof track.coverArtwork === 'string') {
              coverUrl = track.coverArtwork;
            } else if (track.coverArtwork.url) {
              coverUrl = track.coverArtwork.url;
            }
          }

          return {
            id: track.url || track.id.toString(),
            title: track.title,
            artist: track.name || (track.artists && track.artists[0] ? track.artists[0].name : 'Unknown Artist'),
            album: track.album?.title || '',
            durationMs: track.duration ? track.duration * 1000 : track.durationMs || null,
            trackCount: track.album?.track_count || track.album?.trackCount || track.trackCount || null,
            cover: coverUrl,
            service: svc,
            url: track.url,
          };
        });
      } catch (err) {
        // Silently ignore failures for individual services, as requested by the user
        return [];
      }
    });

    const resultsArrays = await Promise.all(searchPromises);
    return resultsArrays.flat();
  }

  getTrackStem(metadata) {
    const artist = metadata.artists?.[0]?.name || "Unknown Artist";
    return `${sanitizeFileName(artist)} - ${sanitizeFileName(metadata.title)}`;
  }

  async getDownloadPath(metadata, baseDir, options = {}) {
    const artist = sanitizeFileName(metadata.artists?.[0]?.name || "Unknown Artist");
    const album = sanitizeFileName(metadata.album?.title || "Singles");
    
    let albumDir = album;
    if (options.albumYear && metadata.releaseDate) {
      const year = new Date(metadata.releaseDate).getFullYear();
      if (options.albumYear === 'append') albumDir = `${albumDir} (${year})`;
      else if (options.albumYear === 'prepend') albumDir = `(${year}) ${albumDir}`;
    }

    if (options.flattenDirectories) {
      return path.join(baseDir, `${artist} - ${albumDir}`);
    }
    return path.join(baseDir, artist, albumDir);
  }

  /**
   * Download a track to the given output path
   */
  async download(url, baseDir, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    
    try {
      onProgress(10, "Resolving track metadata...");
      const trackInfo = await this.lucida.getByUrl(url);
      
      if (!trackInfo || typeof trackInfo.getStream !== 'function') {
        throw new Error("Track could not be resolved or stream unavailable: " + url);
      }

      const metadata = trackInfo.metadata || {};
      const albumPath = await this.getDownloadPath(metadata, baseDir, options);
      await fs.ensureDir(albumPath);

      const stem = this.getTrackStem(metadata);
      onProgress(30, `Downloading stream: ${metadata.title}...`);
      const { stream, mimeType } = await trackInfo.getStream();
      
      let ext = 'mp3';
      if (mimeType.includes('flac')) ext = 'flac';
      else if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = 'm4a';
      else if (mimeType.includes('ogg')) ext = 'ogg';

      const targetPath = path.join(albumPath, `${stem}.${ext}`);
      
      await pipeline(
        stream,
        fs.createWriteStream(targetPath)
      );

      // Download cover if requested
      if (!options.skipCover) {
        const coverUrl = metadata.coverArtwork?.[0]?.url || metadata.pictures?.[0]?.url;
        if (coverUrl) {
          const coverPath = path.join(albumPath, metadata.album?.title ? "cover.jpg" : `${stem}.jpg`);
          try {
            onProgress(80, "Downloading cover art...");
            const response = await fetch(coverUrl);
            if (response.ok) {
              const buffer = Buffer.from(await response.arrayBuffer());
              await fs.writeFile(coverPath, buffer);

              // Wait 1 second as requested before embedding
              onProgress(90, "Waiting for file system...");
              await new Promise(resolve => setTimeout(resolve, 1000));

              // Embed cover into audio
              onProgress(95, "Embedding cover art & metadata...");
              try {
                await embedCoverArt(targetPath, coverPath, {
                  title: metadata.title,
                  artist: metadata.artists?.[0]?.name,
                  album: metadata.album?.title
                });
              } catch (e) {
                console.warn("[BakaScraper] Failed to embed cover:", e.message);
              }
            }
          } catch (e) {
            console.warn("[BakaScraper] Failed to download cover:", e.message);
          }
        }
      }

      onProgress(100, "Download completed");
      return {
        success: true,
        path: targetPath,
        albumPath,
        mimeType,
        metadata
      };

    } catch (err) {
      console.error("[BakaScraper] Download error:", err);
      throw err;
    }
  }
}
