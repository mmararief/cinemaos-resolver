import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const port = 9944;
const userProfileDir = `C:\\Users\\arief\\AppData\\Local\\Temp\\chrome-stack-${Date.now()}`;
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
    await send('Debugger.enable');
    await send('Page.navigate', { url: targetUrl });
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg.result);
      callbacks.delete(msg.id);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const u = msg.params.request.url;
      if (u.includes('_st=')) {
        console.log('\n=============================================');
        console.log('>>> URL WITH _st:', u);
        console.log('Initiator type:', msg.params.initiator?.type);
        console.log('Initiator stack:');
        const frames = msg.params.initiator?.stack?.callFrames || [];
        for (const f of frames) {
          console.log(`  at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber}:${f.columnNumber})`);
        }
        console.log('=============================================\n');
      }
    }
  };

  await wait(15000);
  ws.close();
  chrome.kill('SIGKILL');
  try { rmSync(userProfileDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

run();
