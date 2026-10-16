import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const port = 9933;
const userProfileDir = `C:\\Users\\arief\\AppData\\Local\\Temp\\chrome-rsc-${Date.now()}`;
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
    await send('Page.navigate', { url: targetUrl });
  };

  let token = null;

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
        token = parsed.searchParams.get('_st');
        console.log('FOUND TOKEN:', token);
      }
    }
  };

  await wait(12000);

  // Check document HTML
  const evalRes = await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML' });
  const html = evalRes?.result?.value || '';

  console.log('HTML length:', html.length);
  if (token) {
    console.log('Does HTML contain token directly?', html.includes(token));
    const tokenParts = token.split('.');
    console.log('Does HTML contain token signature part?', html.includes(tokenParts[1]));
  }

  // Check RSC script tags: self.__next_f
  const rscRes = await send('Runtime.evaluate', {
    expression: `
      Array.from(document.querySelectorAll('script'))
        .map(s => s.textContent || '')
        .filter(t => t.includes('scrapeToken') || (t.includes('self.__next_f') && t.includes('watch')))
        .join('\\n---SCRIPT---\\n')
    `
  });
  const rscText = rscRes?.result?.value || '';
  console.log('RSC scripts match length:', rscText.length);
  if (rscText) {
    console.log('RSC sample:\n', rscText.substring(0, 1000));
  }

  ws.close();
  chrome.kill('SIGKILL');
  try { rmSync(userProfileDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

run();
