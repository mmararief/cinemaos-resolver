import { getCinemaosToken } from './dist/token-fetcher.js';
import { CinemaosClient } from './dist/client.js';

async function main() {
  console.log('Testing local token generation on Windows...');
  const client = new CinemaosClient();

  console.log('\n--- 1. Testing Movie: Interstellar (157336) ---');
  const t0 = Date.now();
  const resMovie = await client.resolve({ type: 'movie', tmdbId: 157336, title: 'Interstellar' });
  console.log(`Movie resolved in ${((Date.now() - t0) / 1000).toFixed(2)}s:`);
  console.log('Success:', resMovie.success);
  console.log('Count:', resMovie.count);
  if (resMovie.sources?.length > 0) {
    console.log('Sample source:', resMovie.sources[0].label, resMovie.sources[0].quality);
  }

  console.log('\n--- 2. Testing TV: Breaking Bad S01E01 (1396) ---');
  const t1 = Date.now();
  const resTv = await client.resolve({ type: 'tv', tmdbId: 1396, seasonId: 1, episodeId: 1, title: 'Breaking Bad' });
  console.log(`TV resolved in ${((Date.now() - t1) / 1000).toFixed(2)}s:`);
  console.log('Success:', resTv.success);
  console.log('Count:', resTv.count);
  if (resTv.sources?.length > 0) {
    console.log('Sample source:', resTv.sources[0].label, resTv.sources[0].quality);
  }

  process.exit(0);
}

main().catch(console.error);
