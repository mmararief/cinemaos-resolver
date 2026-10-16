import { generateContentHash, decryptPayload } from './dist/crypto.js';
import { Impit } from 'impit';

async function testFullScrape() {
  const token = '1792160937.ad1dcaa99f0868313937564e4d7be91ddad5b565375c5d58658061ba7f201378';
  const tmdbId = '157336';
  const imdbId = 'tt0816692';
  const secret = generateContentHash({ tmdbId, imdbId });

  const client = new Impit({ browser: 'chrome' });
  const params = new URLSearchParams({
    type: 'movie',
    tmdbId,
    imdbId,
    t: 'Interstellar',
    ry: '2014',
    secret,
    _st: token,
    scraper: 'z2'
  });

  const url = `https://cinemaos.live/api/relay/scrape?${params.toString()}`;
  console.log('Testing full scrape with extracted token on z2 (Zephyr)...');
  const res = await client.fetch(url, {
    headers: {
      'Referer': 'https://cinemaos.live/watch/movie/157336',
      'Origin': 'https://cinemaos.live'
    }
  });

  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Encrypted payload received:', Object.keys(data));

  const payload = decryptPayload(data.data);
  console.log('Decrypted keys:', Object.keys(payload || {}));
  if (payload?.sources) {
    console.log('Sources keys:', Object.keys(payload.sources));
    const firstKey = Object.keys(payload.sources)[0];
    console.log('First source:', firstKey, payload.sources[firstKey]);
  }
}

testFullScrape().catch(console.error);
