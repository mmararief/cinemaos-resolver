async function searchAllChunks() {
  const chunks = [
    'https://cinemaos.live/_next/static/chunks/app/(watch)/watch/%5Btype%5D/%5Bid%5D/page-b88f48e6f3404ab9.js',
    'https://cinemaos.live/_next/static/chunks/main-app-c9cf152fbe76550b.js',
    'https://cinemaos.live/_next/static/chunks/app/layout-9c46a71f4f3815ad.js',
    'https://cinemaos.live/_next/static/chunks/4bd1b696-fe5168af968c5394.js',
    'https://cinemaos.live/_next/static/chunks/1517-2b4c9ac4a1b2e5a0.js',
    'https://cinemaos.live/_next/static/chunks/1181-f6ec003211356e7e.js',
    'https://cinemaos.live/_next/static/chunks/2484-4d2a7c32acc3cd9f.js',
    'https://cinemaos.live/_next/static/chunks/8593-bcda8ce0352a8c8b.js',
  ];

  for (const url of chunks) {
    const res = await fetch(url);
    const code = await res.text();
    for (const kw of ['scrapeToken', 'getScrapeToken', 'createHmac', 'generateToken', 'sessionToken']) {
      let idx = 0;
      while ((idx = code.indexOf(kw, idx)) !== -1) {
        console.log(`\n[${url}] found "${kw}" at ${idx}:`);
        console.log(code.substring(Math.max(0, idx - 150), Math.min(code.length, idx + 250)));
        idx += kw.length;
      }
    }
  }
}

searchAllChunks().catch(console.error);
