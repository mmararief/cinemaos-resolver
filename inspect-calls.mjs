async function findCalls() {
  const url = 'https://cinemaos.live/_next/static/chunks/app/(watch)/watch/%5Btype%5D/%5Bid%5D/page-b88f48e6f3404ab9.js';
  const res = await fetch(url);
  const code = await res.text();
  let pos = 0;
  while ((pos = code.indexOf('buildScrapeBaseParams', pos)) !== -1) {
    console.log(`\n--- buildScrapeBaseParams at ${pos} ---`);
    console.log(code.substring(Math.max(0, pos - 400), Math.min(code.length, pos + 400)));
    pos += 'buildScrapeBaseParams'.length;
  }
}

findCalls().catch(console.error);
