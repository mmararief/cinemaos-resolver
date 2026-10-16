import { Impit } from 'impit';

async function testRsc() {
  const client = new Impit({ browser: 'chrome' });
  const url = 'https://cinemaos.live/watch/movie/550';
  
  console.log('Fetching with RSC: 1 header...');
  const res = await client.fetch(url, {
    headers: {
      'RSC': '1',
      'Next-Router-State-Tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22(watch)%22%2C%7B%22children%22%3A%5B%22watch%22%2C%7B%22children%22%3A%5B%22%5Btype%5D%22%2C%7B%22children%22%3A%5B%22%5Bid%5D%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%5D%7D%5D%7D%5D%7D%5D',
      'Referer': 'https://cinemaos.live/'
    }
  });

  console.log('Status:', res.status);
  console.log('Headers:');
  for (const [k, v] of res.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }

  const text = await res.text();
  console.log('\nResponse length:', text.length);
  console.log('Sample text (first 1000 chars):\n', text.substring(0, 1000));

  if (text.includes('scrapeToken')) {
    console.log('\n>>> SUCCESS! Found scrapeToken in RSC payload!');
    const idx = text.indexOf('scrapeToken');
    console.log(text.substring(Math.max(0, idx - 100), Math.min(text.length, idx + 200)));
  } else {
    console.log('\nDid not find scrapeToken. Searching for other keywords...');
    for (const kw of ['_st', 'token', 'secret', 'tmdbId']) {
      const idx = text.indexOf(kw);
      if (idx !== -1) {
        console.log(`Found "${kw}" at ${idx}:`, text.substring(Math.max(0, idx - 50), Math.min(text.length, idx + 100)));
      }
    }
  }
}

testRsc().catch(console.error);
