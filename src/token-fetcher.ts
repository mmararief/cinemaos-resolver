import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const CACHE_FILE = join(os.homedir(), '.cinemaos-tokens-cache.json');

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

let tokenQueue = Promise.resolve();
const inFlightTokens = new Map<string, Promise<string | null>>();

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

  // 3. Queue execution sequentially so VPS (1 vCPU) only runs 1 browser at a time
  const fetchPromise = new Promise<string | null>((resolve) => {
    tokenQueue = tokenQueue
      .then(async () => {
        try {
          const res = await fetchTokenInternal(type, tmdbId, forceFresh);
          resolve(res);
        } catch (err) {
          console.error(`[TokenFetcher] Error fetching token for ${type}/${idStr}:`, err);
          resolve(null);
        } finally {
          inFlightTokens.delete(idStr);
        }
      })
      .catch((err) => {
        console.error('[TokenFetcher] Queue failure:', err);
        inFlightTokens.delete(idStr);
        resolve(null);
      });
  });

  inFlightTokens.set(idStr, fetchPromise);
  return fetchPromise;
}

async function fetchTokenInternal(
  type: 'movie' | 'tv',
  tmdbId: string | number,
  forceFresh: boolean = false
): Promise<string | null> {
  const idStr = String(tmdbId);

  // Re-check cache in case previous queued job already fetched it
  if (!forceFresh) {
    const cache = loadTokensCache();
    if (cache[idStr] && Date.now() - cache[idStr].timestamp < 10 * 60 * 1000) {
      return cache[idStr].token;
    }
  }

  // Locate Chrome binary
  const chromePath = getChromePath();
  if (!chromePath) {
    console.error('[TokenFetcher] No Chrome binary found on system');
    return null;
  }

  // Pick a random debugging port to avoid collision
  const port = 9300 + Math.floor(Math.random() * 400);
  const userProfileDir = join(os.tmpdir(), `cinemaos-chrome-${Date.now()}-${port}`);
  const targetUrl = `https://cinemaos.live/watch/${type}/${idStr}`;

  const isLinux = os.platform() === 'linux';
  const hasXvfb = isLinux && existsSync('/usr/bin/xvfb-run');

  const baseChromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-fre',
    '--disable-search-engine-choice-screen',
    '--password-store=basic',
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
  } else if (isLinux) {
    spawnArgs = [
      ...baseChromeArgs,
      '--headless=new',
      '--disable-gpu',
      'about:blank',
    ];
  } else {
    spawnArgs = [
      ...baseChromeArgs,
      '--window-position=-3200,-3200',
      '--window-size=800,600',
      'about:blank',
    ];
  }

  console.log(`[TokenFetcher] Spawning Chrome for ${type}/${idStr} on debugging port ${port} (xvfb: ${hasXvfb})...`);
  const chrome = spawn(spawnCmd, spawnArgs);

  return new Promise<string | null>(async (resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try {
          chrome.kill('SIGKILL');
        } catch {}
        if (chrome.pid && isLinux) {
          try {
            spawn('pkill', ['-9', '-P', String(chrome.pid)]);
          } catch {}
        }
        try {
          rmSync(userProfileDir, { recursive: true, force: true });
        } catch {}
      }
    };

    const timer = setTimeout(() => {
      console.warn(`[TokenFetcher] Timeout (25s) reached while fetching token for ${type}/${idStr}`);
      cleanup();
      resolve(null);
    }, 25000);

    try {
      // Wait for Chrome to boot
      await wait(1200);

      // Connect to CDP
      let wsUrl: string | null = null;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json/list`);
          const data: any = await res.json();
          if (Array.isArray(data)) {
            const pageTarget = data.find((t: any) => t.type === 'page');
            if (pageTarget?.webSocketDebuggerUrl) {
              wsUrl = pageTarget.webSocketDebuggerUrl;
              break;
            }
          }
        } catch {}
        await wait(250);
      }

      if (!wsUrl) {
        console.error(`[TokenFetcher] Failed to find page target on port ${port}`);
        cleanup();
        clearTimeout(timer);
        return resolve(null);
      }

      console.log(`[TokenFetcher] Connected to CDP page websocket: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);

      let msgId = 1;
      const send = (method: string, params: any = {}) => {
        ws.send(JSON.stringify({ id: msgId++, method, params }));
      };

      ws.onopen = () => {
        console.log(`[TokenFetcher] Enabling Network/Runtime & navigating to ${targetUrl}...`);
        send('Network.enable');
        send('Page.enable');
        send('Runtime.enable');
        send('Page.navigate', { url: targetUrl });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.method === 'Network.responseReceived') {
            const u = msg.params?.response?.url || '';
            const status = msg.params?.response?.status;
            if (u.includes('cinemaos.live/watch/') || u.includes('/api/relay/')) {
              console.log(`[TokenFetcher] Response received: ${status} for ${u.substring(0, 80)}`);
            }
          }
          if (msg.method === 'Network.requestWillBeSent') {
            const reqUrl = msg.params?.request?.url || '';
            if (reqUrl.includes('/api/relay/scrape') || reqUrl.includes('_st=')) {
              console.log(`[TokenFetcher] Captured relay request: ${reqUrl.substring(0, 100)}...`);
              const u = new URL(reqUrl);
              const st = u.searchParams.get('_st');
              if (st) {
                console.log(`[TokenFetcher] SUCCESS! Token obtained: ${st.substring(0, 20)}...`);
                resolved = true;
                clearTimeout(timer);
                saveTokenToCache(idStr, st);
                ws.close();
                cleanup();
                resolve(st);
              }
            }
          }
        } catch {}
      };

      ws.onerror = (err) => {
        console.error('[TokenFetcher] WebSocket error:', err);
        cleanup();
        clearTimeout(timer);
        resolve(null);
      };
    } catch (err: any) {
      console.error('[TokenFetcher] Exception:', err.message);
      cleanup();
      clearTimeout(timer);
      resolve(null);
    }
  });
}
