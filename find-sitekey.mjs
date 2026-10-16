async function findSiteKey() {
  const url = 'https://cinemaos.live/watch/movie/550';
  const res = await fetch(url);
  const html = await res.text();
  console.log('HTML len:', html.length);
  const m = html.match(/0x4[a-zA-Z0-9_\-]+/g);
  console.log('Found 0x4 matches:', m);
  const keyMatch = html.match(/sitekey:\s*['"]([^'"]+)['"]/);
  console.log('sitekey config match:', keyMatch ? keyMatch[1] : 'not found');
  console.log('Sample HTML:\n', html.substring(0, 1000));
}

findSiteKey().catch(console.error);
