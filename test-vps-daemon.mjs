import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const port = 9977;
const userProfileDir = `/tmp/cinemaos-vps-daemon-${Date.now()}`;
const args = [
  '--auto-servernum',
  '--server-args=-screen 0 1920x1080x24',
  '/usr/bin/google-chrome',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${userProfileDir}`,
  `--remote-debugging-port=${port}`,
  '--window-size=1920,1080',
  'about:blank'
];

console.log('1. Starting persistent daemon Chrome with Xvfb on VPS...');
const chrome = spawn('/usr/bin/xvfb-run', args);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  await wait(2500);
  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await wait(300);
  }

  if (!wsUrl) {
    console.error('No CDP found');
    chrome.kill('SIGKILL');
    return;
  }

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const callbacks = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const curId = id++;
    callbacks.set(curId, resolve);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  ws.onopen = async () => {
    await send('Network.enable');
    await send('Page.enable');
    await send('Runtime.enable');
  };

  let tokenListener = null;

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg.result);
      callbacks.delete(msg.id);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const u = msg.params.request.url;
      if (u.includes('_st=')) {
        const parsed = new URL(u);
        const st = parsed.searchParams.get('_st');
        if (tokenListener) {
          tokenListener(st);
          tokenListener = null;
        }
      }
    }
  };

  await wait(1500);

  async function fetchTokenForUrl(url, label) {
    console.log(`\nNavigating to ${label}...`);
    const start = Date.now();
    const tokenPromise = new Promise((resolve) => {
      tokenListener = resolve;
      setTimeout(() => resolve(null), 20000);
    });

    await send('Page.navigate', { url });
    const token = await tokenPromise;
    const dur = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[${label}] Got token in ${dur}s:`, token ? `${token.substring(0, 25)}...` : 'FAILED');
    return token;
  }

  // First navigation - Cold boot
  await fetchTokenForUrl('https://cinemaos.live/watch/tv/213375', '1. VisionQuest (Initial Cold Visit)');

  // Second navigation - Warm session
  await fetchTokenForUrl('https://cinemaos.live/watch/movie/550', '2. Fight Club (Warm Session)');

  // Third navigation - Warm session
  await fetchTokenForUrl('https://cinemaos.live/watch/movie/157336', '3. Interstellar (Warm Session)');

  console.log('\nAll done! Cleaning up...');
  ws.close();
  chrome.kill('SIGKILL');
  try { rmSync(userProfileDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

run().catch(console.error);
