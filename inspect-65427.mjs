async function inspectModule() {
  const url = 'https://cinemaos.live/_next/static/chunks/app/(watch)/watch/%5Btype%5D/%5Bid%5D/page-b88f48e6f3404ab9.js';
  const res = await fetch(url);
  const code = await res.text();
  const idx = code.indexOf('65427:');
  console.log(code.substring(idx, idx + 2500));
}

inspectModule().catch(console.error);
