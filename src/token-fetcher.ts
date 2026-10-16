import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { Impit } from 'impit';

const CACHE_FILE = join(os.homedir(), '.cinemaos-tokens-cache.json');
const CLEARANCE_CACHE = join(os.homedir(), '.cinemaos-clearance.json');

const CANDIDATE_CHROME_PATHS = [
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function getChromePath(): string | null {
  for (const path of CANDIDATE_CHROME_PATHS) {
    if (path && existsSync(path)) {
      return path;
    }
  }
  return null;
}

function loadTokensCache(): Record<string, { token: string; timestamp: number }> {
  try {
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveTokenToCache(tmdbId: string, token: string) {
  try {
    const cache = loadTokensCache();
    cache[tmdbId] = { token, timestamp: Date.now() };
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {}
}

interface ClearanceData {
  cookieHeader: string;
  userAgent: string;
  timestamp: number;
}

function loadClearance(): ClearanceData | null {
  try {
    if (existsSync(CLEARANCE_CACHE)) {
      const data = JSON.parse(readFileSync(CLEARANCE_CACHE, 'utf-8'));
      // Valid for 6 hours
      if (Date.now() - data.timestamp < 6 * 3600 * 1000) {
        return data;
      }
    }
  } catch {}
  return null;
}

function saveClearance(cookieHeader: string, userAgent: string) {
  try {
    writeFileSync(CLEARANCE_CACHE, JSON.stringify({ cookieHeader, userAgent, timestamp: Date.now() }, null, 2), 'utf-8');
  } catch {}
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function invalidateTokenCache(tmdbId?: string | number) {
  try {
    const cache = loadTokensCache();
    if (tmdbId) {
      delete cache[String(tmdbId)];
    }
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {}
}

let harvestQueue = Promise.resolve();

async function harvestClearanceCookie(): Promise<ClearanceData | null> {
  const chromePath = getChromePath();
  if (!chromePath) return null;

  return new Promise<ClearanceData | null>((resolve) => {
    harvestQueue = harvestQueue.then(async () => {
      // Recheck cache in case previous job harvested it
      const cached = loadClearance();
      if (cached) {
        resolve(cached);
        return;
      }

      console.log('[Clearance] Spawning background browser to harvest cf_clearance cookie...');
      const port = 9300 + Math.floor(Math.random() * 400);
      const userProfileDir = join(os.tmpdir(), `cinemaos-harvest-${Date.now()}-${port}`);
      const isLinux = os.platform() === 'linux';
      const hasXvfb = isLinux && existsSync('/usr/bin/xvfb-run');

      const baseChromeArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${userProfileDir}`,
        `--remote-debugging-port=${port}`,
      ];

      let spawnCmd = chromePath;
      let spawnArgs: string[] = [];

      if (hasXvfb) {
        spawnCmd = '/usr/bin/xvfb-run';
        spawnArgs = [
          '--auto-servernum',
          '--server-args=-screen 0 1920x1080x24',
          chromePath,
          ...baseChromeArgs,
          '--window-size=1920,1080',
          'about:blank',
        ];
      } else {
        spawnArgs = [
          ...baseChromeArgs,
          '--window-position=-3200,-3200',
          '--window-size=1280,720',
          'about:blank',
        ];
      }

      const chrome = spawn(spawnCmd, spawnArgs);
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          try { chrome.kill('SIGKILL'); } catch {}
          if (chrome.pid && isLinux) {
            try { spawn('pkill', ['-9', '-P', String(chrome.pid)]); } catch {}
          }
          try { rmSync(userProfileDir, { recursive: true, force: true }); } catch {}
        }
      };

      const timer = setTimeout(() => {
        console.warn('[Clearance] Harvest timeout (18s)');
        cleanup();
        resolve(null);
      }, 18000);

      try {
        await wait(1500);
        let wsUrl: string | null = null;
        for (let i = 0; i < 20; i++) {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list: any = await res.json();
            const page = list.find((t: any) => t.type === 'page');
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
        const send = (method: string, params: any = {}) => new Promise((res) => {
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

        const cookiesRes: any = await send('Network.getCookies');
        const cookies = cookiesRes?.cookies || [];
        const cfClearance = cookies.find((c: any) => c.name === 'cf_clearance');

        const uaRes: any = await send('Runtime.evaluate', { expression: 'navigator.userAgent' });
        const userAgent = uaRes?.result?.value || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

        const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');

        ws.close();
        cleanup();
        clearTimeout(timer);

        if (cfClearance) {
          console.log('[Clearance] SUCCESS! Harvested cf_clearance cookie.');
          saveClearance(cookieHeader, userAgent);
          const data: ClearanceData = { cookieHeader, userAgent, timestamp: Date.now() };
          resolve(data);
        } else {
          console.warn('[Clearance] cf_clearance not found in cookies.');
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

const inFlightTokens = new Map<string, Promise<string | null>>();

/**
 * High-speed token extractor:
 * 1. Checks local cache (< 10 min) -> 0ms
 * 2. Uses cf_clearance cookie via Impit HTTP request -> ~300ms (ZERO BROWSER)
 * 3. Falls back to harvesting cookie if expired -> 6s once per 6 hours
 */
export async function getCinemaosToken(
  type: 'movie' | 'tv',
  tmdbId: string | number,
  forceFresh: boolean = false
): Promise<string | null> {
  const idStr = String(tmdbId);

  // 1. Check local cache (valid for 10 minutes) unless forceFresh requested
  if (!forceFresh) {
    const cache = loadTokensCache();
    if (cache[idStr] && Date.now() - cache[idStr].timestamp < 10 * 60 * 1000) {
      return cache[idStr].token;
    }
  }

  // 2. If already fetching for this ID, reuse that exact promise
  if (inFlightTokens.has(idStr)) {
    return inFlightTokens.get(idStr)!;
  }

  const fetchPromise = (async () => {
    try {
      // Try fast HTTP extraction with cf_clearance cookie
      let clearance = loadClearance();
      if (!clearance) {
        clearance = await harvestClearanceCookie();
      }

      if (clearance) {
        const client = new Impit({ browser: 'chrome' });
        const targetUrl = `https://cinemaos.live/watch/${type}/${idStr}`;

        for (let attempt = 0; attempt < 2; attempt++) {
          if (!clearance) break;
          try {
            const currentClearance = clearance;
            const t0 = Date.now();
            const res = await client.fetch(targetUrl, {
              headers: {
                'Cookie': currentClearance.cookieHeader,
                'User-Agent': currentClearance.userAgent,
                'Referer': 'https://cinemaos.live/'
              },
              signal: AbortSignal.timeout(6000)
            });

            const html = await res.text();
            const dur = Date.now() - t0;

            if (res.status === 200 && !html.includes('Just a moment...')) {
              const match = html.match(/1792\d{6}\.[a-f0-9]{64}/);
              if (match) {
                const token = match[0];
                console.log(`[TokenFetcher] ⚡ Token extracted in ${dur}ms (0 BROWSER): ${token.substring(0, 20)}...`);
                saveTokenToCache(idStr, token);
                return token;
              }
            }

            // If 403 challenge, clearance cookie expired, harvest new one once
            if (attempt === 0 && (res.status === 403 || html.includes('Just a moment...'))) {
              console.log('[TokenFetcher] Clearance expired. Harvesting fresh cookie...');
              clearance = await harvestClearanceCookie();
              if (!clearance) break;
            }
          } catch {}
        }
      }

      return null;
    } finally {
      inFlightTokens.delete(idStr);
    }
  })();

  inFlightTokens.set(idStr, fetchPromise);
  return fetchPromise;
}
