import { Impit } from 'impit';
import { generateContentHash, decryptPayload } from './crypto.js';
import { getCinemaosToken, invalidateTokenCache } from './token-fetcher.js';
import type {
  ContentType,
  ContentInfo,
  CinemaosResolutionResult,
  CinemaosSource,
  CinemaosSubtitle,
  ScrapeOptions,
  DecryptedScrapeData,
} from './types.js';

export const KNOWN_CINEMAOS_TOKENS: Record<string, string> = {};

export const DEFAULT_SCRAPERS = [
  'z2',
  'mb2',
  'ntm',
  'q4',
  'vn',
  's3',
  'mv',
  'va',
  'vf',
  'vs',
];

export class CinemaosClient {
  private client: Impit;
  private baseUrl: string;

  constructor(baseUrl: string = 'https://cinemaos.live') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.client = new Impit({ browser: 'chrome' });
  }

  /**
   * Fetches TMDB metadata & external IDs from CinemaOS's internal TMDB relay.
   */
  async resolveMetadata(type: ContentType, tmdbId: string | number): Promise<{
    title: string;
    imdbId?: string;
    year?: string;
  }> {
    const requestID = type === 'tv' ? 'tvData' : 'movieData';
    const tmdbUrl = `${this.baseUrl}/api/tmdb?id=${tmdbId}&requestID=${requestID}&language=en-US`;

    try {
      const res = await this.client.fetch(tmdbUrl, {
        headers: { Referer: `${this.baseUrl}/` },
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data: any = await res.json();
        const title = data.name || data.title || '';
        const imdbId = data.external_ids?.imdb_id || data.imdb_id;
        const dateStr = data.first_air_date || data.release_date;
        const year = dateStr ? String(new Date(dateStr).getFullYear()) : undefined;
        return { title, imdbId, year };
      }
    } catch {}

    return { title: '' };
  }

  /**
   * Scrapes CinemaOS relay endpoints across multiple scrapers.
   */
  async resolve(info: ContentInfo, options: ScrapeOptions = {}): Promise<CinemaosResolutionResult> {
    const tmdbIdStr = String(info.tmdbId);
    let imdbId = info.imdbId;
    let title = info.title;
    let year = info.year;

    // 1. Fetch metadata if missing
    if (!imdbId || !title) {
      const meta = await this.resolveMetadata(info.type, tmdbIdStr);
      if (!title && meta.title) title = meta.title;
      if (!imdbId && meta.imdbId) imdbId = meta.imdbId;
      if (!year && meta.year) year = meta.year;
    }

    // Specific fallback for VisionQuest
    if (!imdbId && tmdbIdStr === '213375') {
      imdbId = 'tt23112594';
    }
    if (!title) {
      title = tmdbIdStr === '213375' ? 'VisionQuest' : `TMDB-${tmdbIdStr}`;
    }

    const seasonStr = String(info.seasonId || 1);
    const episodeStr = String(info.episodeId || 1);

    const secret = generateContentHash({
      tmdbId: tmdbIdStr,
      imdbId,
      ...(info.type === 'tv' ? { seasonId: seasonStr, episodeId: episodeStr } : {}),
    });

    let token = options.token;
    if (!token) {
      token = (await getCinemaosToken(info.type, tmdbIdStr)) || undefined;
    }

    if (!token) {
      return {
        success: false,
        type: info.type,
        tmdbId: tmdbIdStr,
        title,
        imdbId,
        season: info.type === 'tv' ? Number(seasonStr) : undefined,
        episode: info.type === 'tv' ? Number(episodeStr) : undefined,
        count: 0,
        sources: [],
        subtitles: [],
        error: 'Failed to obtain CinemaOS session token.',
      };
    }

    const scrapersToQuery = options.scrapers || DEFAULT_SCRAPERS;
    let sources: CinemaosSource[] = [];
    const subtitles: CinemaosSubtitle[] = [];
    const seenUrls = new Set<string>();
    let forbiddenCount = 0;

    const fetchScraper = async (scraperId: string) => {
      try {
        const params = new URLSearchParams({
          type: info.type,
          tmdbId: tmdbIdStr,
          ...(imdbId ? { imdbId } : {}),
          ...(info.type === 'tv' ? { seasonId: seasonStr, episodeId: episodeStr } : {}),
          t: title || '',
          ry: year || '',
          secret,
          _st: token,
          scraper: scraperId,
        });

        const scrapeUrl = `${this.baseUrl}/api/relay/scrape?${params.toString()}`;
        const res = await this.client.fetch(scrapeUrl, {
          headers: {
            Referer: `${this.baseUrl}/watch/${info.type}/${tmdbIdStr}`,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(options.timeoutMs || 8000),
        });

        if (!res.ok) {
          if (res.status === 403) {
            forbiddenCount++;
          }
          return;
        }

        const resJson: any = await res.json();
        let payload: DecryptedScrapeData | null = resJson;

        if (resJson.encrypted && resJson.data) {
          payload = decryptPayload(resJson.data);
        }

        if (!payload || !payload.sources) return;

        // Process streams
        for (const [srvKey, srvObj] of Object.entries(payload.sources)) {
          if (!srvObj) continue;

          let streamUrl = srvObj.url;
          let isMp4 = srvObj.type === 'mp4' || (streamUrl && streamUrl.endsWith('.mp4'));
          let quality = srvObj.quality || srvObj.bitrate || '1080p';

          // Extract MP4 direct links if stored in qualities map
          if (!streamUrl && (srvObj as any).qualities) {
            const quals = (srvObj as any).qualities;
            const chosen =
              quals['1080'] || quals['720'] || quals['480'] || quals['360'] || Object.values(quals)[0];
            if (chosen && chosen.url) {
              streamUrl = chosen.url;
              isMp4 = true;
              quality = chosen.quality || '1080p';
            }
          }

          if (!streamUrl || seenUrls.has(streamUrl)) continue;
          seenUrls.add(streamUrl);

          const isDash = srvObj.type === 'dash' || streamUrl.includes('.mpd');
          const streamType: 'hls' | 'mpd' | 'mp4' = isDash ? 'mpd' : isMp4 ? 'mp4' : 'hls';

          // Parse audio language from server name (e.g. "Alpha - English", "Halo - 720p Hindi", "Tamil")
          let audio: string | undefined;
          const knownLangs = [
            'English',
            'Hindi',
            'Portuguese',
            'Spanish',
            'Tamil',
            'Telugu',
            'French',
            'German',
            'Italian',
            'Japanese',
            'Korean',
            'Indonesian',
            'Russian',
            'Mandarin',
            'Chinese',
            'Arabic',
          ];
          for (const lang of knownLangs) {
            if (new RegExp(`\\b${lang}\\b`, 'i').test(srvKey)) {
              audio = lang;
              break;
            }
          }

          sources.push({
            source: `cinemaos-${scraperId}-${srvKey.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
            label: `CinemaOS VIP - ${payload.name || scraperId.toUpperCase()} (${srvKey} ${quality})`,
            url: streamUrl,
            quality,
            type: streamType,
            server: srvKey,
            scraper: scraperId,
            audio,
          });
        }

        // Process captions
        if (Array.isArray(payload.captions)) {
          for (const cap of payload.captions) {
            if (!cap || !cap.url) continue;
            const lang = cap.language || 'en';
            const label = cap.label || 'English';
            subtitles.push({
              label,
              lang,
              file: cap.url,
              isIndonesian:
                lang === 'in' || lang === 'id' || label.toLowerCase().includes('indo'),
            });
          }
        }
      } catch (err: any) {
        // Scraper failed, continue with others
      }
    };

    await Promise.allSettled(scrapersToQuery.map((s) => fetchScraper(s)));

    // If all scrapers were rejected with 403 Forbidden, token is expired or invalid.
    // Invalidate cache, obtain a fresh token using Chrome, and retry once!
    if (sources.length === 0 && forbiddenCount > 0 && !options.token) {
      invalidateTokenCache(tmdbIdStr);
      const freshToken = await getCinemaosToken(info.type, tmdbIdStr, true);
      if (freshToken) {
        token = freshToken;
        forbiddenCount = 0;
        await Promise.allSettled(scrapersToQuery.map((s) => fetchScraper(s)));
      }
    }

    // Fast concurrent probe to filter dead 502/404 streams and detect HEVC codecs
    const validatedSources: CinemaosSource[] = [];
    await Promise.allSettled(
      sources.map(async (src) => {
        try {
          const probeHeaders: Record<string, string> = {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://cinemaos.live/',
            Origin: 'https://cinemaos.live',
            Range: 'bytes=0-1024',
          };

          const checkRes = await fetch(src.url, {
            method: 'GET',
            headers: probeHeaders,
            signal: AbortSignal.timeout(2500),
          });

          // Drop dead / bad gateway responses
          if (!checkRes.ok && checkRes.status !== 206) {
            return;
          }

          // For binary MP4 files, do not buffer whole file
          if (src.type === 'mp4') {
            try { checkRes.body?.cancel(); } catch {}
            validatedSources.push(src);
            return;
          }

          // For manifests (M3U8 / MPD), read first chunk safely
          let headSnippet = '';
          if (checkRes.body) {
            const reader = checkRes.body.getReader();
            const { value } = await reader.read();
            if (value) {
              headSnippet = new TextDecoder().decode(value);
            }
            try { reader.cancel(); } catch {}
          }

          if (
            headSnippet.includes('502 Bad Gateway') ||
            headSnippet.includes('Error 502') ||
            headSnippet.includes('504 Gateway') ||
            headSnippet.includes('404 Not Found')
          ) {
            return;
          }

          // Detect HEVC/H.265 in DASH manifests
          if (src.type === 'mpd' && (headSnippet.includes('hev1') || headSnippet.includes('hvc1'))) {
            src.quality = `${src.quality} (HEVC)`;
            (src as any).isHevc = true;
          }

          validatedSources.push(src);
        } catch {
          // If probe timed out, retain original if needed
        }
      })
    );

    const activeSources = validatedSources.length > 0 ? validatedSources : sources;

    // Prioritize universal HLS (H.264) & 4K/1080p, while deprioritizing HEVC DASH
    activeSources.sort((a, b) => {
      const getScore = (s: any) => {
        let score = 0;
        // Universal HLS runs in all browsers natively with hls.js
        if (s.type === 'hls') score += 100;
        else if (s.type === 'mp4') score += 70;
        else if (s.type === 'mpd') {
          score += s.isHevc ? 10 : 50;
        }

        if (s.quality.includes('4K') || s.quality.includes('2160')) score += 40;
        else if (s.quality.includes('1080') || s.quality.includes('FHD')) score += 30;
        else if (s.quality.includes('720')) score += 20;
        else if (s.quality.includes('480')) score += 10;

        return score;
      };
      return getScore(b) - getScore(a);
    });

    sources = activeSources;

    let error: string | undefined;
    if (sources.length === 0) {
      if (forbiddenCount > 0) {
        error = `CinemaOS rejected request with 403 Forbidden. The session token (_st) is unique per TMDB title and must be generated for TMDB ID: ${tmdbIdStr}.`;
      } else {
        error = `No active streams found on CinemaOS relay scrapers for ${title || tmdbIdStr}.`;
      }
    }

    return {
      success: sources.length > 0,
      type: info.type,
      tmdbId: tmdbIdStr,
      title,
      imdbId,
      season: info.type === 'tv' ? Number(seasonStr) : undefined,
      episode: info.type === 'tv' ? Number(episodeStr) : undefined,
      count: sources.length,
      sources,
      subtitles,
      error,
    };
  }

  /**
   * Helper to resolve movie streams.
   */
  async resolveMovie(tmdbId: string | number, options?: ScrapeOptions): Promise<CinemaosResolutionResult> {
    return this.resolve({ type: 'movie', tmdbId }, options);
  }

  /**
   * Helper to resolve TV episode streams.
   */
  async resolveEpisode(
    tmdbId: string | number,
    season: number = 1,
    episode: number = 1,
    options?: ScrapeOptions
  ): Promise<CinemaosResolutionResult> {
    return this.resolve(
      { type: 'tv', tmdbId, seasonId: season, episodeId: episode },
      options
    );
  }
}
