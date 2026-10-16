async function findVariableG() {
  const url = 'https://cinemaos.live/_next/static/chunks/app/(watch)/watch/%5Btype%5D/%5Bid%5D/page-b88f48e6f3404ab9.js';
  const res = await fetch(url);
  const code = await res.text();
  const idx = code.indexOf('(t,n,x,g,h,u)');
  console.log(code.substring(idx - 1200, idx + 100));
}

findVariableG().catch(console.error);
