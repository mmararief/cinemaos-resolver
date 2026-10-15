# 🎬 cinemaos-resolver

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org/)

High-performance video stream and subtitle extractor for **CinemaOS** (`cinemaos.live`). Powered by reverse-engineered dual-HMAC content signature cascading, PBKDF2 + AES-256-GCM payload decryption, and multi-mirror relay scrapers.

---

## ✨ Features

- ⚡ **Multi-Mirror Parallel Extraction**: Scrapes Movy (Altair, Sirius 4K, Spica), Vidapi (Helios, Selene direct master HLS), Vidfast (MiamiC 1080p), and Vidstuck (DASH MPD).
- 🔐 **Dual-HMAC SHA-256 Authentication**: Accurately computes content hashes to bypass CinemaOS anti-tamper security.
- 🛡️ **AES-256-GCM Payload Decryption**: Seamlessly derives cryptographic keys via PBKDF2 (100,000 iterations) to decode encrypted relay payloads.
- 🤖 **Automatic Token Fetching & Caching**: Automatically resolves and caches dynamic CinemaOS session tokens (`_st`) in the background via stealth browser CDP without any manual token copying.
- 💻 **Multiple Interfaces**: Use it as a **TypeScript / JavaScript library**, an **Interactive Terminal UI (TUI)**, a **CLI tool**, or a standalone **REST API microservice**.

---

## 🚀 Quick Start

### 1. Interactive Terminal UI (TUI)
Explore and stream movies or series directly from your terminal:
```bash
npx cinemaos-tui
```

### 2. Command Line Interface (CLI)
Resolve any movie or TV series by TMDB ID:

```bash
# VisionQuest Season 1 Episode 1 (TV Show)
npx cinemaos-resolver 213375 --type tv -s 1 -e 1

# Fight Club (Movie)
npx cinemaos-resolver 550 --type movie

# Output raw JSON for script integration
npx cinemaos-resolver 213375 -s 1 -e 1 --json
```

### 3. REST API Microservice
Start the built-in HTTP microservice with live Web UI:
```bash
npx cinemaos-api
# or via npm script
npm run api
```
Access the server at `http://localhost:3003`:
- **Scrape Episode**: `GET /api/resolve?type=tv&id=213375&s=1&e=1`
- **Scrape Movie**: `GET /api/resolve?type=movie&id=550`
- **Health Check**: `GET /health`

---

## 📦 Programmatic Usage

### Installation
```bash
npm install cinemaos-resolver
# or
pnpm add cinemaos-resolver
# or
yarn add cinemaos-resolver
```

### Example: Resolve TV Episode
```typescript
import { resolveEpisode } from 'cinemaos-resolver';

async function main() {
  const result = await resolveEpisode(213375, 1, 1);

  if (result.success) {
    console.log(`Title: ${result.title}`);
    console.log(`Found ${result.sources.length} stream sources:`);

    for (const source of result.sources) {
      console.log(`[${source.quality}] (${source.type.toUpperCase()}) ${source.label}`);
      console.log(`URL: ${source.url}\n`);
    }

    console.log(`Found ${result.subtitles.length} subtitle tracks:`);
    for (const sub of result.subtitles) {
      console.log(`- [${sub.lang}] ${sub.label}: ${sub.file}`);
    }
  }
}

main();
```

### Example: Custom Client Configuration
```typescript
import { CinemaosClient } from 'cinemaos-resolver';

const client = new CinemaosClient('https://cinemaos.live');

const movieStreams = await client.resolveMovie(550, {
  timeoutMs: 10000,
  scrapers: ['mv', 'va'], // Focus only on Movy and Vidapi
});
```

---

## 🛠️ REST API Specification

### `GET /api/resolve` or `GET /api/scrape`
Scrapes video sources and subtitles for a given movie or TV episode.

#### Parameters:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` / `tmdbId` | `string` \| `number` | **Yes** | TMDB ID of the title |
| `type` | `'movie'` \| `'tv'` | No | Defaults to `movie` (or `tv` if season/episode specified) |
| `s` / `season` | `number` | No | TV show season (default: `1`) |
| `e` / `episode` | `number` | No | TV show episode (default: `1`) |
| `imdbId` | `string` | No | IMDb ID (auto-resolved from TMDB if omitted) |
| `scrapers` | `string` | No | Comma-delimited list of scrapers (`mv,va,vf,vs`) |
| `token` | `string` | No | Custom CinemaOS session token `_st` |

#### Sample Response:
```json
{
  "success": true,
  "type": "tv",
  "tmdbId": "213375",
  "title": "VisionQuest",
  "imdbId": "tt23112594",
  "season": 1,
  "episode": 1,
  "count": 4,
  "sources": [
    {
      "source": "cinemaos-va-selene",
      "label": "CinemaOS VIP - Vidapi (Selene 1080p)",
      "url": "https://selene.example.com/master.m3u8",
      "quality": "1080p",
      "type": "hls",
      "server": "Selene",
      "scraper": "va"
    }
  ],
  "subtitles": [
    {
      "label": "Indonesian",
      "lang": "id",
      "file": "https://cinemaos.live/subtitles/213375-id.vtt",
      "isIndonesian": true
    }
  ]
}
```

---

## 🔬 Reverse Engineering & Cryptography

CinemaOS implements a two-tier protection mechanism to prevent scraping:

### 1. Dual-HMAC Cascade Content Secret
Requests to `/api/relay/scrape` require a `secret` query parameter generated by cascading HMAC-SHA256 calculations:
```
InnerHash = HMAC_SHA256(PRIMARY_KEY, "tmdbId:...|imdbId:...|seasonId:...|episodeId:...")
Secret    = HMAC_SHA256(SECONDARY_KEY, InnerHash)
```

### 2. PBKDF2 + AES-256-GCM Payload Decryption
Relay responses are returned with encrypted payloads:
```json
{
  "encrypted": true,
  "data": {
    "salt": "<hex>",
    "cin": "<hex_iv>",
    "mao": "<hex_auth_tag>",
    "payload": "<hex_ciphertext>"
  }
}
```
`cinemaos-resolver` derives the 32-byte AES key using PBKDF2 with 100,000 iterations over the CinemaOS master encryption secret, then decrypts the ciphertext using AES-256-GCM.

---

## 📜 License

MIT License © 2026 Muhammad Ammar Arief.
