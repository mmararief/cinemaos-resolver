async function findScrapeToken() {
  const url = 'https://cinemaos.live/_next/static/chunks/app/(watch)/watch/%5Btype%5D/%5Bid%5D/page-b88f48e6f3404ab9.js';
  const res = await fetch(url);
  const code = await res.text();
  let pos = 0;
  while ((pos = code.indexOf('scrapeToken', pos)) !== -1) {
    console.log(`\n--- scrapeToken at ${pos} ---`);
    console.log(code.substring(Math.max(0, pos - 200), Math.min(code.length, pos + 300)));
    pos += 'scrapeToken'.length;
  }
}

findScrapeToken().catch(console.error);
