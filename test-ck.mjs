import { generateContentHash } from './dist/crypto.js';
import { Impit } from 'impit';

async function testCk() {
  const client = new Impit({ browser: 'chrome' });
  const tmdbId = '550';
  const imdbId = 'tt0137523';
  const secret = generateContentHash({ tmdbId, imdbId });

  const params = new URLSearchParams({
    type: 'movie',
    tmdbId,
    imdbId,
    t: 'Fight Club',
    ry: '1999',
    secret,
    _ck: '6775dc8e702c08643385273df088c14952c590ddda02d14f',
    scraper: 'mb2'
  });

  const url = `https://cinemaos.live/api/relay/scrape?${params.toString()}`;
  console.log('Testing url with _ck:\n', url);

  const res = await client.fetch(url, {
    headers: {
      'Referer': 'https://cinemaos.live/watch/movie/550',
      'Origin': 'https://cinemaos.live'
    }
  });

  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.substring(0, 300));
}

testCk().catch(console.error);
