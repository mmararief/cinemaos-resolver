import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { Impit } from 'impit';

const port = 9988;
const userProfileDir = `C:\\Users\\arief\\AppData\\Local\\Temp\\chrome-cookie-${Date.now()}`;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const args = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${userProfileDir}`,
  `--remote-debugging-port=${port}`,
  '--window-position=-3200,-3200',
  '--window-size=1280,720',
  'about:blank'
];

console.log('1. Spawning Chrome to obtain cf_clearance cookie once...');
const chrome = spawn(chromePath, args);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  await wait(1500);
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
    await wait(200);
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
    await send('Page.navigate', { url: 'https://cinemaos.live/watch/movie/550' });
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg.result);
      callbacks.delete(msg.id);
    }
  };

  // Wait 7s for Turnstile to pass
  await wait(7000);

  // Extract cookies
  const cookiesRes = await send('Network.getCookies');
  const cookies = cookiesRes?.cookies || [];
  console.log('Cookies retrieved:', cookies.map(c => `${c.name}=${c.value.substring(0, 15)}...`));

  const uaRes = await send('Runtime.evaluate', { expression: 'navigator.userAgent' });
  const userAgent = uaRes?.result?.value;
  console.log('User Agent:', userAgent);

  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // CLOSE AND KILL CHROME IMMEDIATELY
  console.log('\n2. KILLING CHROME COMPLETELY! Chrome is now dead.');
  ws.close();
  chrome.kill('SIGKILL');
  try { rmSync(userProfileDir, { recursive: true, force: true }); } catch {}

  // 3. NOW TEST PURE HTTP (IMPIT / FETCH) WITHOUT ANY BROWSER!
  console.log('\n3. Testing pure HTTP fetch using cf_clearance cookie...');
  const client = new Impit({ browser: 'chrome' });

  for (const [title, url] of [
    ['Interstellar', 'https://cinemaos.live/watch/movie/157336'],
    ['Breaking Bad', 'https://cinemaos.live/watch/tv/1396'],
    ['Inception', 'https://cinemaos.live/watch/movie/27205']
  ]) {
    const t0 = Date.now();
    const res = await client.fetch(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': userAgent,
        'Referer': 'https://cinemaos.live/'
      }
    });
    const html = await res.text();
    const dur = Date.now() - t0;
    console.log(`[${title}] HTTP Status: ${res.status} in ${dur}ms (HTML len: ${html.length})`);
    
    // Check if HTML contains scrapeToken or if it was blocked
    const isBlocked = html.includes('Just a moment...') || res.status === 403;
    console.log(`  Blocked by Cloudflare? ${isBlocked ? 'YES (403)' : 'NO (PASSED 200 OK!)'}`);
    if (!isBlocked) {
      // Find token in HTML
      const match = html.match(/1792\d{6}\.[a-f0-9]{64}/);
      console.log(`  Extracted Token: ${match ? match[0] : 'not found in html'}`);
    }
  }

  process.exit(0);
}

run().catch(console.error);
