async function findPageExport() {
  const url = 'https://cinemaos.live/_next/static/chunks/app/(watch)/watch/%5Btype%5D/%5Bid%5D/page-b88f48e6f3404ab9.js';
  const res = await fetch(url);
  const code = await res.text();
  console.log('Chunk length:', code.length);

  // Look for occurrences of x( or <x or default
  for (const kw of ['default', 'Page', 'scrapeToken']) {
    let pos = 0;
    while ((pos = code.indexOf(kw, pos)) !== -1) {
      console.log(`[${kw} at ${pos}]:`, code.substring(Math.max(0, pos - 100), Math.min(code.length, pos + 150)));
      pos += kw.length;
    }
  }
}

findPageExport().catch(console.error);
