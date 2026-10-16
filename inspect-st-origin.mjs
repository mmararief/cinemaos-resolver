import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const port = 9922;
const userProfileDir = `C:\\Users\\arief\\AppData\\Local\\Temp\\chrome-inspect-${Date.now()}`;
const targetUrl = 'https://cinemaos.live/watch/movie/550';

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

  if (!wsUrl) {
    console.error('No CDP');
    chrome.kill('SIGKILL');
    return;
  }

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: id++, method, params }));

  ws.onopen = () => {
    send('Network.enable');
    send('Page.enable');
    send('Runtime.enable');
    send('Page.navigate', { url: targetUrl });
  };

  const requests = [];

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request;
      requests.push({
        url: r.url,
        method: r.method,
        type: msg.params.type,
      });
      if (r.url.includes('/api/relay/scrape') || r.url.includes('_st=')) {
        console.log('\n=============================================');
        console.log('>>> CAPTURED _st RELAY REQUEST:');
        console.log(r.url);
        console.log('=============================================\n');
      }
    }
  };

  await wait(8000);

  console.log('--- ALL REQUESTS MADE BEFORE / DURING LOAD ---');
  for (const req of requests) {
    if (!req.url.endsWith('.png') && !req.url.endsWith('.jpg') && !req.url.endsWith('.woff2') && !req.url.endsWith('.css')) {
      console.log(`[${req.type || 'fetch'}] ${req.method} ${req.url.substring(0, 110)}`);
    }
  }

  ws.close();
  chrome.kill('SIGKILL');
  try { rmSync(userProfileDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

run();
