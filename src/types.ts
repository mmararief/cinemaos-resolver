export type ContentType = 'movie' | 'tv';

export interface ContentInfo {
  type: ContentType;
  tmdbId: string | number;
  imdbId?: string;
  seasonId?: string | number;
  episodeId?: string | number;
  title?: string;
  year?: string;
}

export interface CinemaosEncryptedPayload {
  encrypted: string;
  cin: string; // IV (hex, 16 bytes)
  mao: string; // Auth Tag (hex, 16 bytes)
  salt?: string; // Salt (hex, 32 bytes)
  version?: number;
}

export interface RawStreamSource {
  server?: string;
  url: string;
  quality?: string;
  bitrate?: string;
  speed?: string;
  type?: string;
}

export interface RawCaption {
  url: string;
  language?: string;
  label?: string;
}

export interface DecryptedScrapeData {
  name?: string;
  sources?: Record<string, RawStreamSource>;
  captions?: RawCaption[];
}

export interface CinemaosSource {
  source: string;
  label: string;
  url: string;
  quality: string;
  type: 'hls' | 'mpd';
  server: string;
  scraper: string;
}

export interface CinemaosSubtitle {
  label: string;
  lang: string;
  file: string;
  isIndonesian: boolean;
}

export interface CinemaosResolutionResult {
  success: boolean;
  type: ContentType;
  tmdbId: string;
  title: string;
  imdbId?: string;
  season?: number;
  episode?: number;
  count: number;
  sources: CinemaosSource[];
  subtitles: CinemaosSubtitle[];
}

export interface ScrapeOptions {
  token?: string;
  scrapers?: string[];
  timeoutMs?: number;
}
