import { readFileSync, existsSync } from 'node:fs';

async function inspectChunk() {
  const url = 'https://cinemaos.live/_next/static/chunks/app/(watch)/watch/%5Btype%5D/%5Bid%5D/page-b88f48e6f3404ab9.js';
  const res = await fetch(url);
  const code = await res.text();
  console.log('Downloaded page chunk. Len:', code.length);

  // Search for _st or scrape
  for (const kw of ['_st', 'relay/scrape', 'sessionToken']) {
    let pos = 0;
    while ((pos = code.indexOf(kw, pos)) !== -1) {
      console.log(`\n--- KW: "${kw}" at index ${pos} ---`);
      console.log(code.substring(Math.max(0, pos - 200), Math.min(code.length, pos + 300)));
      pos += kw.length;
    }
  }
}

inspectChunk().catch(console.error);
