#!/usr/bin/env node

import http from 'node:http';
import { Readable } from 'node:stream';
import { URL } from 'node:url';
import { CinemaosClient, KNOWN_CINEMAOS_TOKENS } from './client.js';
import { searchMediaByTitle } from './search.js';
import { renderPlayerHtml } from './player-html.js';
import type { CinemaosResolutionResult, ContentType } from './types.js';

export interface ApiServerOptions {
  port?: number;
  host?: string;
  client?: CinemaosClient;
  baseUrl?: string;
}

export function createApiServer(options: ApiServerOptions = {}) {
  const port = options.port || parseInt(process.env.PORT || '3003', 10);
  const host = options.host || process.env.HOST || '0.0.0.0';
  const client = options.client || new CinemaosClient(options.baseUrl);

  const server = http.createServer(async (req, res) => {
    // CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const hostHeader = req.headers.host || `localhost:${port}`;
      const protocol = (req.socket as any).encrypted ? 'https' : 'http';
      const requestUrl = new URL(req.url || '/', `${protocol}://${hostHeader}`);
      const serverOrigin = `${protocol}://${hostHeader}`;
      const pathname = requestUrl.pathname;

      // 1. Health check
      if (pathname === '/health' || pathname === '/api/health') {
        sendJson(res, 200, {
          status: 'ok',
          service: 'cinemaos-resolver',
          version: '1.0.0',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // 2. Built-in Web Stream Player with Subtitles (/player)
      if (pathname === '/player' || pathname === '/api/player') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderPlayerHtml(serverOrigin));
        return;
      }

      // 2b. Stream & Subtitle Proxy (/api/proxy)
      if (pathname === '/api/proxy') {
        const targetUrl = requestUrl.searchParams.get('url');
        if (!targetUrl) {
          sendJson(res, 400, { error: 'Missing required query parameter "url"' });
          return;
        }

        try {
          const reqHeaders: Record<string, string> = {
            Referer: 'https://cinemaos.live/',
            Origin: 'https://cinemaos.live',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          };
          if (req.headers.range) {
            reqHeaders.Range = req.headers.range;
          }

          const upstreamRes = await fetch(targetUrl, {
            headers: reqHeaders,
          });

          const contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
          const headers: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': contentType,
          };
          if (upstreamRes.headers.get('content-range')) {
            headers['Content-Range'] = upstreamRes.headers.get('content-range')!;
          }
          if (upstreamRes.headers.get('accept-ranges')) {
            headers['Accept-Ranges'] = upstreamRes.headers.get('accept-ranges')!;
          }
          if (upstreamRes.headers.get('content-length')) {
            headers['Content-Length'] = upstreamRes.headers.get('content-length')!;
          }

          // If M3U8 playlist, rewrite relative URLs
          if (
            contentType.includes('mpegurl') ||
            targetUrl.includes('.m3u8') ||
            targetUrl.includes('m3u8-proxy')
          ) {
            const m3u8Text = await upstreamRes.text();
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

            const lines = m3u8Text.split('\n');
            const rewrittenLines = lines.map((line) => {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) {
                if (trimmed.includes('URI="')) {
                  return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
                    let fullUri = uri;
                    if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
                      fullUri = new URL(uri, baseUrl).toString();
                    }
                    return `URI="${serverOrigin}/api/proxy?url=${encodeURIComponent(fullUri)}"`;
                  });
                }
                return line;
              }

              let fullSegmentUrl = trimmed;
              if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
                fullSegmentUrl = new URL(trimmed, baseUrl).toString();
              }
              return `${serverOrigin}/api/proxy?url=${encodeURIComponent(fullSegmentUrl)}`;
            });

            const output = rewrittenLines.join('\n');
            res.writeHead(upstreamRes.status, {
              ...headers,
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Content-Length': Buffer.byteLength(output).toString(),
            });
            res.end(output);
            return;
          }

          // If DASH MPD manifest, rewrite initialization and media templates
          if (
            contentType.includes('dash+xml') ||
            targetUrl.includes('.mpd')
          ) {
            let mpdText = await upstreamRes.text();
            const proxiedPrefix = `${serverOrigin}/api/proxy?url=`;

            mpdText = mpdText.replace(/(initialization|media)="([^"]+)"/g, (match, attr, urlVal) => {
              const encoded = encodeURIComponent(urlVal)
                .replace(/%24RepresentationID%24/g, '$RepresentationID$')
                .replace(/%24Number%2505d%24/g, '$Number%05d$')
                .replace(/%24Number%24/g, '$Number$');
              return `${attr}="${proxiedPrefix}${encoded}"`;
            });

            res.writeHead(upstreamRes.status, {
              ...headers,
              'Content-Type': 'application/dash+xml',
              'Content-Length': Buffer.byteLength(mpdText).toString(),
            });
            res.end(mpdText);
            return;
          }

          // Stream binary chunks (MP4, TS, SRT, VTT, M4S) with native backpressure
          res.writeHead(upstreamRes.status, headers);
          if (upstreamRes.body) {
            const nodeStream = Readable.fromWeb(upstreamRes.body as any);
            res.on('close', () => {
              try {
                nodeStream.destroy();
              } catch {}
            });
            nodeStream.pipe(res);
          } else {
            res.end();
          }
          return;
        } catch (err: any) {
          if (!res.headersSent) {
            sendJson(res, 500, { error: err.message });
          }
          return;
        }
      }

      // 2c. Documentation / Web UI
      if (pathname === '/' || pathname === '/api') {
        const accept = req.headers.accept || '';
        if (accept.includes('text/html')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderDocumentationHtml(serverOrigin));
          return;
        }

        sendJson(res, 200, {
          name: 'CinemaOS Stream & Subtitle Resolver API',
          version: '1.0.0',
          endpoints: {
            player: `${serverOrigin}/player?title=Fight+Club`,
            proxy: `${serverOrigin}/api/proxy?url=<url>`,
            health: `${serverOrigin}/health`,
            search: `${serverOrigin}/api/search?q=Fight+Club`,
            resolve: `${serverOrigin}/api/resolve?type=tv&id=213375&s=1&e=1`,
            scrape: `${serverOrigin}/api/scrape?type=movie&id=550`,
            metadata: `${serverOrigin}/api/metadata?type=tv&id=213375`,
          },
          supportedScrapers: [
            'z2 (Zephyr 4K)',
            'mb2 (MovieBoxV2)',
            'va (Vidapi)',
            'vf (Vidfast)',
            'vs (Vidstuck)',
            'mv (Movy)',
          ],
        });
        return;
      }

      // 3. Search Movies & TV series by title (/api/search)
      if (pathname === '/api/search') {
        const query =
          requestUrl.searchParams.get('q') ||
          requestUrl.searchParams.get('query') ||
          requestUrl.searchParams.get('title');
        const filterType = (requestUrl.searchParams.get('type') as 'movie' | 'tv') || undefined;

        if (!query) {
          sendJson(res, 400, {
            error: 'Missing required query parameter "q" (Title to search)',
            example: `${serverOrigin}/api/search?q=Breaking+Bad`,
          });
          return;
        }

        const results = await searchMediaByTitle(query, filterType);
        sendJson(res, 200, {
          success: true,
          query,
          count: results.length,
          results,
        });
        return;
      }

      // 4. Resolve metadata
      if (pathname === '/api/metadata') {
        const type = (requestUrl.searchParams.get('type') as ContentType) || 'movie';
        let id = requestUrl.searchParams.get('id') || requestUrl.searchParams.get('tmdbId');

        if (!id || isNaN(Number(id))) {
          const query = id || requestUrl.searchParams.get('q') || requestUrl.searchParams.get('title');
          if (query) {
            const matches = await searchMediaByTitle(query, type);
            if (matches.length > 0) {
              id = String(matches[0].id);
            }
          }
        }

        if (!id) {
          sendJson(res, 400, { error: 'Missing required query parameter "id" or title to search' });
          return;
        }

        const meta = await client.resolveMetadata(type, id);
        sendJson(res, 200, { success: true, tmdbId: id, type, ...meta });
        return;
      }

      // 5. Resolve Stream & Subtitles (/api/resolve or /api/scrape)
      if (pathname === '/api/resolve' || pathname === '/api/scrape') {
        let id =
          requestUrl.searchParams.get('id') ||
          requestUrl.searchParams.get('tmdbId') ||
          requestUrl.searchParams.get('tmdb');

        const rawType = requestUrl.searchParams.get('type');
        const sParam = requestUrl.searchParams.get('s') || requestUrl.searchParams.get('season');
        const eParam = requestUrl.searchParams.get('e') || requestUrl.searchParams.get('episode');

        // Automatically infer TV if season/episode provided
        let type: ContentType =
          rawType === 'tv' || rawType === 'movie'
            ? rawType
            : (sParam || eParam ? 'tv' : 'movie');

        const titleParam = requestUrl.searchParams.get('t') || requestUrl.searchParams.get('title');

        // Search by title if id is not numeric or missing
        if (!id || isNaN(Number(id))) {
          const query = id || titleParam || requestUrl.searchParams.get('q');
          if (query) {
            const matches = await searchMediaByTitle(query, rawType === 'tv' || rawType === 'movie' ? rawType : undefined);
            if (matches.length > 0) {
              id = String(matches[0].id);
              if (!rawType) {
                type = matches[0].type;
              }
            }
          }
        }

        if (!id) {
          sendJson(res, 400, {
            error: 'Missing required parameter "id" (TMDB ID or Title to search)',
            example: `${serverOrigin}/api/resolve?title=Breaking+Bad&s=1&e=1`,
          });
          return;
        }

        const imdbId = requestUrl.searchParams.get('imdbId') || requestUrl.searchParams.get('imdb') || undefined;
        const title = requestUrl.searchParams.get('t') || requestUrl.searchParams.get('title') || undefined;
        const year = requestUrl.searchParams.get('y') || requestUrl.searchParams.get('year') || undefined;
        const token = requestUrl.searchParams.get('token') || requestUrl.searchParams.get('_st') || undefined;
        
        const rawScrapers = requestUrl.searchParams.get('scrapers');
        const scrapers = rawScrapers ? rawScrapers.split(',').map((s) => s.trim()) : undefined;

        const result: CinemaosResolutionResult = await client.resolve(
          {
            type,
            tmdbId: id,
            imdbId,
            title,
            year,
            seasonId: sParam ? parseInt(sParam, 10) : undefined,
            episodeId: eParam ? parseInt(eParam, 10) : undefined,
          },
          { token, scrapers }
        );

        sendJson(res, result.success ? 200 : 404, result);
        return;
      }

      // 404 Not Found
      sendJson(res, 404, {
        error: 'Not Found',
        path: pathname,
        help: `Visit ${serverOrigin}/ for interactive API documentation`,
      });
    } catch (err: any) {
      console.error('[CinemaOS API Error]:', err);
      sendJson(res, 500, {
        error: 'Internal Server Error',
        message: err.message || String(err),
      });
    }
  });

  return {
    server,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, host, () => {
          console.log(`\n🎬 CinemaOS Resolver API Server is running:`);
          console.log(`   ➜ Local:   http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
          console.log(`   ➜ Health:  http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/health`);
          console.log(`   ➜ Scrape:  http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api/scrape?type=tv&id=213375&s=1&e=1\n`);
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(data, null, 2));
}

function renderDocumentationHtml(origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CinemaOS Resolver Microservice</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #121826;
      --card-border: #1e293b;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --accent: #06b6d4;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --code-bg: #030712;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 2.5rem;
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.4);
      color: #818cf8;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: 9999px;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #fff 0%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    h2 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #e2e8f0;
    }
    .endpoint {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
      background: var(--code-bg);
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      border: 1px solid #1f2937;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
    }
    .method {
      background: #0284c7;
      color: white;
      font-weight: 700;
      padding: 0.15rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
    }
    .url {
      color: #38bdf8;
      text-decoration: none;
      word-break: break-all;
    }
    .url:hover { text-decoration: underline; }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    .feature-item {
      background: rgba(255, 255, 255, 0.03);
      padding: 1rem;
      border-radius: 0.75rem;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .feature-item h3 {
      font-size: 1rem;
      color: var(--accent);
      margin-bottom: 0.25rem;
    }
    .feature-item p {
      font-size: 0.875rem;
      color: var(--text-muted);
    }
    .test-box {
      margin-top: 1rem;
      display: flex;
      gap: 0.5rem;
    }
    input {
      flex: 1;
      background: var(--code-bg);
      border: 1px solid #334155;
      color: white;
      padding: 0.6rem 1rem;
      border-radius: 0.5rem;
      font-family: inherit;
    }
    button {
      background: var(--primary);
      color: white;
      border: none;
      padding: 0.6rem 1.25rem;
      border-radius: 0.5rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: var(--primary-hover);
    }
    pre {
      background: var(--code-bg);
      padding: 1rem;
      border-radius: 0.5rem;
      overflow-x: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: #a5b4fc;
      max-height: 350px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="badge">v1.0.0 Microservice</span>
      <h1>CinemaOS Resolver API</h1>
      <p class="subtitle">High-performance VIP stream & subtitle extractor for CinemaOS</p>
    </header>

    <div class="card">
      <h2>🚀 Live Endpoints</h2>
      
      <div class="endpoint">
        <span class="method">GET</span>
        <a class="url" href="${origin}/api/resolve?type=tv&id=213375&s=1&e=1" target="_blank">${origin}/api/resolve?type=tv&id=213375&s=1&e=1</a>
      </div>

      <div class="endpoint">
        <span class="method">GET</span>
        <a class="url" href="${origin}/api/scrape?type=movie&id=550" target="_blank">${origin}/api/scrape?type=movie&id=550</a>
      </div>

      <div class="endpoint">
        <span class="method">GET</span>
        <a class="url" href="${origin}/api/metadata?type=tv&id=213375" target="_blank">${origin}/api/metadata?type=tv&id=213375</a>
      </div>

      <div class="endpoint">
        <span class="method">GET</span>
        <a class="url" href="${origin}/health" target="_blank">${origin}/health</a>
      </div>
    </div>

    <div class="card">
      <h2>⚡ Test Stream Extractor</h2>
      <div class="test-box">
        <input type="text" id="testUrl" value="/api/resolve?type=tv&id=213375&s=1&e=1" placeholder="Enter endpoint path...">
        <button onclick="runTest()">Execute</button>
      </div>
      <div style="margin-top: 1rem;">
        <pre id="testOutput">// Click "Execute" to fetch streams & subtitles...</pre>
      </div>
    </div>

    <div class="card">
      <h2>🛡️ Architecture Highlights</h2>
      <div class="features">
        <div class="feature-item">
          <h3>Dual-HMAC Cryptography</h3>
          <p>Extracts content secrets using primary & secondary SHA-256 HMAC cascading keys matching CinemaOS backend rules.</p>
        </div>
        <div class="feature-item">
          <h3>PBKDF2 + AES-256-GCM</h3>
          <p>Decrypts encrypted response payloads with 100,000 PBKDF2 iterations using custom salt, cin (IV), and mao (AuthTag).</p>
        </div>
        <div class="feature-item">
          <h3>Multi-Mirror Scrapers</h3>
          <p>Parallel queries against Movy (Altair, Sirius 4K, Spica), Vidapi (Helios, Selene), Vidfast (MiamiC), and Vidstuck (DASH).</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    async function runTest() {
      const output = document.getElementById('testOutput');
      const input = document.getElementById('testUrl').value;
      output.textContent = 'Resolving streams...';
      try {
        const res = await fetch(input);
        const data = await res.json();
        output.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        output.textContent = 'Error: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
}

// Start immediately if executed directly via CLI or PM2
const isDirectExecution =
  process.argv[1]?.replace(/\\/g, '/').endsWith('/api.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('/api.js') ||
  process.env.pm_exec_path?.replace(/\\/g, '/').endsWith('/api.js') ||
  process.env.PM2_HOME !== undefined ||
  process.env.PORT !== undefined;

if (isDirectExecution) {
  createApiServer().start();
}
