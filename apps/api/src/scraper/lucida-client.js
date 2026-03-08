import JSON5 from "json5";
import { env } from "../config/env.js";
import { httpClient } from "../lib/http-client.js";

function parseEnclosedValue(text, startMarker, endMarker) {
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`Missing marker: ${startMarker}`);
  const contentStart = startIdx + startMarker.length;

  const endIdx = text.indexOf(endMarker, contentStart);
  if (endIdx === -1) throw new Error(`Missing marker: ${endMarker}`);

  return text.slice(contentStart, endIdx);
}

export class LucidaClient {
  async fetchSearchHtml(query) {
    const response = await httpClient.get(`${env.lucidaBaseUrl}/search`, {
      params: {
        service: "tidal",
        country: env.defaultCountry,
        query,
      },
    });

    return response.data;
  }

  async resolveItemPage(url, country = env.defaultCountry) {
    const response = await httpClient.get(`${env.lucidaBaseUrl}/`, {
      params: { url, country },
    });

    return response.data;
  }

  parsePageData(html) {
    if (!html || typeof html !== 'string') {
      throw new Error("Invalid HTML response received from Lucida");
    }

    // Try multiple marker patterns that Lucida may use
    const markers = [
      { start: 'const data = [', prefix: 'const data = ' },
      { start: 'var data = [', prefix: 'var data = ' },
      { start: 'let data = [', prefix: 'let data = ' },
      { start: 'window.__DATA__ = [', prefix: 'window.__DATA__ = ' },
      { start: 'window.data = [', prefix: 'window.data = ' },
      { start: 'window.__NUXT__ = [', prefix: 'window.__NUXT__ = ' },
    ];

    let raw = null;
    for (const { start, prefix } of markers) {
      const startIdx = html.indexOf(start);
      if (startIdx === -1) continue;

      const endIdx = html.indexOf('];', startIdx);
      if (endIdx === -1) continue;

      raw = html.slice(startIdx + prefix.length, endIdx + 1);
      break;
    }

    if (!raw) {
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1] : 'unknown';
      throw new Error(`Unable to find Lucida data block in page (title: "${pageTitle}"). The site structure may have changed.`);
    }

    let data;
    try {
      data = JSON5.parse(raw);
    } catch (e) {
      throw new Error(`Failed to parse Lucida data: ${e.message}`);
    }

    if (!Array.isArray(data)) {
      throw new Error("Lucida data is not an array");
    }

    // Find the item that contains the "info" object with metadata
    for (const item of data) {
      if (item.type === "data" && item.data && item.data.info) {
        return item.data;
      }
    }

    // Fallback: check if any item directly has info
    for (const item of data) {
      if (item.info) {
        return item;
      }
    }

    // Fallback: if data[0] has type/title fields, treat it as info directly
    if (data.length > 0 && data[0] && (data[0].type === 'album' || data[0].type === 'track')) {
      return { info: data[0], token: null };
    }

    throw new Error(`No metadata found in Lucida data block. Data keys: ${data.map(d => JSON.stringify(Object.keys(d || {}))).join(', ')}`);
  }

  async requestTrackHandoff({ country, metadata, isPrivate, tokenExpiry, csrf, csrfFallback, url }) {
    const response = await httpClient.post(`${env.lucidaBaseUrl}/api/load?url=%2Fapi%2Ffetch%2Fstream%2Fv2`, {
      account: {
        id: country,
        type: "country",
      },
      compat: false,
      downscale: "original",
      handoff: true,
      metadata,
      private: isPrivate,
      token: {
        expiry: tokenExpiry,
        primary: csrf,
        secondary: csrfFallback ?? null,
      },
      upload: { enabled: false },
      url,
    });

    if (response.data?.error) {
      throw new Error(response.data.error);
    }

    return response.data;
  }

  async getRequestStatus(handoff) {
    const response = await httpClient.get(`https://${handoff.server}.lucida.to/api/fetch/request/${handoff.handoff}`);
    return response.data;
  }

  async downloadRequestFile(handoff) {
    return httpClient.get(`https://${handoff.server}.lucida.to/api/fetch/request/${handoff.handoff}/download`, {
      responseType: "stream",
    });
  }
}
