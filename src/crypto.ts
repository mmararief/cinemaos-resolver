import crypto from 'node:crypto';
import type { CinemaosEncryptedPayload, DecryptedScrapeData } from './types.js';

export const CINEMAOS_PRIMARY_KEY =
  'a7f3b9c2e8d4f1a6b5c9e2d7f4a8b3c6e1d9f7a4b2c8e5d3f9a6b4c1e7d2f8a5';

export const CINEMAOS_SECONDARY_KEY =
  'd3f8a5b2c9e6d1f7a4b8c5e2d9f3a6b1c7e4d8f2a9b5c3e7d4f1a8b6c2e9d5f3';

export const CINEMAOS_ENCRYPTION_KEY =
  'a1b2c3d4e4f6477658455678901477567890abcdef1234567890abcdef123456';

/**
 * Generates the chained double-HMAC-SHA256 signature required by CinemaOS relay scrapers.
 *
 * Formula:
 * HMAC_SHA256(secondaryKey, HMAC_SHA256(primaryKey, payload))
 */
export function generateContentHash(data: {
  tmdbId: string | number;
  imdbId?: string;
  seasonId?: string | number;
  episodeId?: string | number;
}): string {
  const parts: string[] = [];
  if (data.tmdbId) parts.push(`tmdbId:${data.tmdbId}`);
  if (data.imdbId) parts.push(`imdbId:${data.imdbId}`);
  if (data.seasonId != null && '' !== String(data.seasonId)) {
    parts.push(`seasonId:${data.seasonId}`);
  }
  if (data.episodeId != null && '' !== String(data.episodeId)) {
    parts.push(`episodeId:${data.episodeId}`);
  }

  const payload = parts.join('|');
  const h1 = crypto.createHmac('sha256', CINEMAOS_PRIMARY_KEY).update(payload).digest('hex');
  return crypto.createHmac('sha256', CINEMAOS_SECONDARY_KEY).update(h1).digest('hex');
}

/**
 * Decrypts AES-256-GCM payloads returned by CinemaOS relay API.
 * Uses PBKDF2 key derivation (100,000 iterations, 32 bytes, SHA-256).
 */
export function decryptPayload(payload: CinemaosEncryptedPayload): DecryptedScrapeData | null {
  if (!payload || typeof payload !== 'object') return null;
  const { encrypted, cin, mao, salt } = payload;
  if (!encrypted || !cin || !mao) return null;

  try {
    const iv = Buffer.from(cin, 'hex');
    const authTag = Buffer.from(mao, 'hex');
    const saltBuf = salt
      ? Buffer.from(salt, 'hex')
      : crypto.createHash('sha256').update(iv).digest().subarray(0, 32);

    const derivedKey = crypto.pbkdf2Sync(CINEMAOS_ENCRYPTION_KEY, saltBuf, 100000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'hex')),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as DecryptedScrapeData;
  } catch (err) {
    return null;
  }
}
