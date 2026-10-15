import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Automatically obtains an active CinemaOS session token (_st)
 * using background Chrome CDP interception and local caching.
 */
export async function getCinemaosToken(
  type: 'movie' | 'tv',
  tmdbId: string | number
): Promise<string | null> {
  const idStr = String(tmdbId);

  // 1. Check local cache (valid for 3 days = 259,200,000 ms)
  const cache = loadTokensCache();
  if (cache[idStr] && Date.now() - cache[idStr].timestamp < 3 * 24 * 60 * 60 * 1000) {
    return cache[idStr].token;
  }

  // 2. Locate Chrome binary
  const chromePath = getChromePath();
  if (!chromePath) {
    return null;
  }

  // Pick a random debugging port to avoid collision
  const port = 9300 + Math.floor(Math.random() * 400);
  const userProfileDir = join(os.homedir(), '.cinemaos-chrome-profile');
  const targetUrl = `https://cinemaos.live/watch/${type}/${idStr}`;

  const chrome = spawn(chromePath, [
    `--user-data-dir=${userProfileDir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-fre',
    '--disable-search-engine-choice-screen',
    '--password-store=basic',
    '--window-position=-3200,-3200',
    '--window-size=800,600',
    'about:blank',
  ]);

  return new Promise<string | null>(async (resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try {
          chrome.kill();
        } catch {}
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 12000);

    try {
      // Connect to CDP
      let wsUrl: string | null = null;
      for (let i = 0; i < 25; i++) {
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
        cleanup();
        clearTimeout(timer);
        return resolve(null);
      }

      const ws = new WebSocket(wsUrl);

      let msgId = 1;
      const send = (method: string, params: any = {}) => {
        ws.send(JSON.stringify({ id: msgId++, method, params }));
      };

      ws.onopen = () => {
        send('Network.enable');
        send('Page.enable');
        send('Page.navigate', { url: targetUrl });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.method === 'Network.requestWillBeSent') {
            const reqUrl = msg.params?.request?.url || '';
            if (reqUrl.includes('/api/relay/scrape')) {
              const u = new URL(reqUrl);
              const st = u.searchParams.get('_st');
              if (st) {
                resolved = true;
                clearTimeout(timer);
                saveTokenToCache(idStr, st);
                ws.close();
                try {
                  chrome.kill();
                } catch {}
                resolve(st);
              }
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        cleanup();
        clearTimeout(timer);
        resolve(null);
      };
    } catch {
      cleanup();
      clearTimeout(timer);
      resolve(null);
    }
  });
}
