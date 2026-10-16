import { CinemaosClient } from './dist/client.js';

async function testBB() {
  const client = new CinemaosClient();
  const res = await client.resolve({
    type: 'tv',
    tmdbId: 1396,
    seasonId: 1,
    episodeId: 1,
    title: 'Breaking Bad',
    year: '2008'
  });
  console.log('Breaking Bad result:', res);
  process.exit(0);
}

testBB().catch(console.error);
