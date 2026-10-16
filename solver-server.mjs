import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { Impit } from 'impit';
import { CinemaosClient } from './dist/client.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3003;
const CLEARANCE_CACHE = join(os.homedir(), '.cinemaos-clearance.json');
const TOKEN_CACHE_FILE = join(os.homedir(), '.cinemaos-tokens-cache.json');

const CANDIDATE_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

function getChromePath() {
  for (const p of CANDIDATE_CHROME_PATHS) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function loadTokensCache() {
  try {
    if (existsSync(TOKEN_CACHE_FILE)) return JSON.parse(readFileSync(TOKEN_CACHE_FILE, 'utf-8'));
  } catch {}
  return {};
}

function saveTokenToCache(tmdbId, token) {
  try {
    const cache = loadTokensCache();
    cache[tmdbId] = { token, timestamp: Date.now() };
    writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {}
}

function loadClearance() {
  try {
    if (existsSync(CLEARANCE_CACHE)) {
      const data = JSON.parse(readFileSync(CLEARANCE_CACHE, 'utf-8'));
      if (Date.now() - data.timestamp < 6 * 3600 * 1000) return data;
    }
  } catch {}
  return null;
}

function saveClearance(cookieHeader, userAgent) {
  try {
    writeFileSync(CLEARANCE_CACHE, JSON.stringify({ cookieHeader, userAgent, timestamp: Date.now() }, null, 2), 'utf-8');
  } catch {}
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

let harvestQueue = Promise.resolve();

async function harvestClearanceCookie() {
  const chromePath = getChromePath();
  if (!chromePath) return null;

  return new Promise((resolve) => {
    harvestQueue = harvestQueue.then(async () => {
      const cached = loadClearance();
      if (cached) return resolve(cached);

      console.log('[Solver] Spawning Chrome to harvest cf_clearance cookie...');
      const port = 9400 + Math.floor(Math.random() * 300);
      const userProfileDir = join(os.tmpdir(), `cinemaos-solver-${Date.now()}-${port}`);
      const isLinux = os.platform() === 'linux';
      const hasXvfb = isLinux && existsSync('/usr/bin/xvfb-run');

      const baseArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${userProfileDir}`,
        `--remote-debugging-port=${port}`,
      ];

      const spawnCmd = hasXvfb ? '/usr/bin/xvfb-run' : chromePath;
      const spawnArgs = hasXvfb
        ? ['--auto-servernum', '--server-args=-screen 0 1920x1080x24', chromePath, ...baseArgs, '--window-size=1920,1080', 'about:blank']
        : [...baseArgs, '--window-position=-3200,-3200', '--window-size=1280,720', 'about:blank'];

      const chrome = spawn(spawnCmd, spawnArgs);
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          try { chrome.kill('SIGKILL'); } catch {}
          try { rmSync(userProfileDir, { recursive: true, force: true }); } catch {}
        }
      };

      const timer = setTimeout(() => {
        console.warn('[Solver] Harvest timeout (15s)');
        cleanup();
        resolve(null);
      }, 15000);

      try {
        await wait(1500);
        let wsUrl = null;
        for (let i = 0; i < 20; i++) {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list = await res.json();
            const page = list.find((t) => t.type === 'page');
            if (page?.webSocketDebuggerUrl) {
              wsUrl = page.webSocketDebuggerUrl;
              break;
            }
          } catch {}
          await wait(250);
        }

        if (!wsUrl) {
          cleanup();
          clearTimeout(timer);
          return resolve(null);
        }

        const ws = new WebSocket(wsUrl);
        let id = 1;
        const callbacks = new Map();
        const send = (method, params = {}) => new Promise((res) => {
          const curId = id++;
          callbacks.set(curId, res);
          ws.send(JSON.stringify({ id: curId, method, params }));
        });

        ws.onopen = async () => {
          await send('Network.enable');
          await send('Page.enable');
          await send('Page.navigate', { url: 'https://cinemaos.live/watch/tv/213375' });
        };

        ws.onmessage = (e) => {
          const msg = JSON.parse(String(e.data));
          if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg.result);
            callbacks.delete(msg.id);
          }
        };

        // Wait 6.5s for Turnstile to clear
        await wait(6500);

        const cookiesRes = await send('Network.getCookies');
        const cookies = cookiesRes?.cookies || [];
        const cfClearance = cookies.find((c) => c.name === 'cf_clearance');

        const uaRes = await send('Runtime.evaluate', { expression: 'navigator.userAgent' });
        const userAgent = uaRes?.result?.value || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

        ws.close();
        cleanup();
        clearTimeout(timer);

        if (cfClearance) {
          console.log('[Solver] SUCCESS! Harvested fresh cf_clearance cookie.');
          saveClearance(cookieHeader, userAgent);
          resolve({ cookieHeader, userAgent, timestamp: Date.now() });
        } else {
          console.warn('[Solver] cf_clearance not found in cookies.');
          resolve(null);
        }
      } catch (err) {
        cleanup();
        clearTimeout(timer);
        resolve(null);
      }
    }).catch(() => resolve(null));
  });
}

const inFlight = new Map();

async function solveToken(type, tmdbId) {
  const idStr = String(tmdbId);

  // 1. Check local cache (10 min)
  const cache = loadTokensCache();
  if (cache[idStr] && Date.now() - cache[idStr].timestamp < 10 * 60 * 1000) {
    return { token: cache[idStr].token, cached: true, durMs: 0 };
  }

  if (inFlight.has(idStr)) {
    return inFlight.get(idStr);
  }

  const p = (async () => {
    try {
      let clearance = loadClearance();
      if (!clearance) clearance = await harvestClearanceCookie();
      if (!clearance) return { token: null, error: 'Could not harvest Cloudflare clearance' };

      const client = new Impit({ browser: 'chrome' });
      const targetUrl = `https://cinemaos.live/watch/${type}/${idStr}`;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (!clearance) break;
        try {
          const t0 = Date.now();
          const res = await client.fetch(targetUrl, {
            headers: {
              'Cookie': clearance.cookieHeader,
              'User-Agent': clearance.userAgent,
              'Referer': 'https://cinemaos.live/'
            },
            signal: AbortSignal.timeout(6000)
          });

          const html = await res.text();
          const durMs = Date.now() - t0;

          if (res.status === 200 && !html.includes('Just a moment...')) {
            const match = html.match(/1792\d{6}\.[a-f0-9]{64}/);
            if (match) {
              const token = match[0];
              saveTokenToCache(idStr, token);
              return { token, cached: false, durMs };
            }
          }

          if (attempt === 0 && (res.status === 403 || html.includes('Just a moment...'))) {
            clearance = await harvestClearanceCookie();
            if (!clearance) break;
          }
        } catch (err) {
          console.error('[Solver] Fetch attempt error:', err.message);
        }
      }

      return { token: null, error: 'Failed to extract token from SSR HTML' };
    } finally {
      inFlight.delete(idStr);
    }
  })();

  inFlight.set(idStr, p);
  return p;
}

const cinemaosClient = new CinemaosClient();

// HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // 1. Health check
  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'online',
      service: 'CinemaOS Turnstile Private Solver',
      uptime: process.uptime(),
      cachedTokens: Object.keys(loadTokensCache()).length,
      hasClearance: !!loadClearance(),
    }, null, 2));
  }

  // 2. Solve token: GET /solve?type=movie&id=550 or /api/solve
  if (pathname === '/solve' || pathname === '/api/solve') {
    const type = url.searchParams.get('type') || 'movie';
    const id = url.searchParams.get('id');

    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing parameter "id" (TMDB ID)' }));
    }

    const t0 = Date.now();
    const result = await solveToken(type, id);

    if (result.token) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        type,
        id,
        token: result.token,
        cached: result.cached,
        timeMs: result.durMs || (Date.now() - t0),
      }));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: result.error }));
    }
  }

  // 3. Complete Scrape: GET /scrape or /api/scrape or /api/resolve or /api/cinemaos/resolve
  if (
    pathname === '/scrape' ||
    pathname === '/api/scrape' ||
    pathname === '/api/resolve' ||
    pathname === '/api/cinemaos/resolve' ||
    pathname === '/api/cinemaos/scrape'
  ) {
    const type = url.searchParams.get('type') || 'movie';
    const id = url.searchParams.get('id');
    const seasonId = url.searchParams.get('s') || url.searchParams.get('season') || '1';
    const episodeId = url.searchParams.get('e') || url.searchParams.get('episode') || '1';
    const title = url.searchParams.get('title') || undefined;

    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing parameter "id"' }));
    }

    try {
      // 1. Solve token ultra-fast
      const tokenRes = await solveToken(type, id);
      const token = tokenRes.token;

      // 2. Scrape with CinemaosClient
      const resolution = await cinemaosClient.resolve({
        type,
        tmdbId: id,
        seasonId: type === 'tv' ? seasonId : undefined,
        episodeId: type === 'tv' ? episodeId : undefined,
        title,
      }, { token: token || undefined });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(resolution, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // 4. Clearance cookie: GET /clearance
  if (pathname === '/clearance' || pathname === '/api/clearance') {
    const clearance = loadClearance();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(clearance || { status: 'none' }, null, 2));
  }

  // 5. Sync clearance: GET /api/sync-clearance?cookie=...&ua=...
  if (pathname === '/api/sync-clearance' || pathname === '/sync-clearance') {
    const cookie = url.searchParams.get('cookie');
    const ua = url.searchParams.get('ua') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    if (cookie) {
      saveClearance(cookie, ua);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Clearance cookie saved successfully' }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing "cookie" query parameter' }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Private CapSolver Server running at:`);
  console.log(`   ➜ Local:   http://localhost:${PORT}`);
  console.log(`   ➜ Health:  http://localhost:${PORT}/health`);
  console.log(`   ➜ Solve:   http://localhost:${PORT}/api/solve?type=movie&id=550`);
  console.log(`   ➜ Scrape:  http://localhost:${PORT}/api/scrape?type=movie&id=550`);
  console.log(`======================================================\n`);
});
