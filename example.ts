import { resolveEpisode } from './src/index.js';

async function run() {
  console.log('Testing CinemaOS Stream Resolver on VisionQuest (TMDB 213375, S1E1)...');
  
  const startTime = Date.now();
  const res = await resolveEpisode(213375, 1, 1);
  const elapsed = Date.now() - startTime;

  console.log(`Resolution completed in ${elapsed}ms:`);
  console.log('Success:', res.success);
  console.log('Title:', res.title);
  console.log('Streams found:', res.sources.length);
  console.log('Subtitles found:', res.subtitles.length);

  console.log('\nTop Streams:');
  res.sources.slice(0, 5).forEach((s, idx) => {
    console.log(`  [${idx + 1}] ${s.quality} (${s.type}) - ${s.label}`);
    console.log(`      ${s.url}`);
  });

  console.log('\nIndonesian Subtitles:');
  const indoSubs = res.subtitles.filter(s => s.isIndonesian);
  if (indoSubs.length > 0) {
    indoSubs.forEach(s => console.log(`  [${s.lang}] ${s.label}: ${s.file}`));
  } else {
    console.log('  None found');
  }
}

run().catch(console.error);
