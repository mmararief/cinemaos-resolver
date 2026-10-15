#!/usr/bin/env node

import pc from 'picocolors';
import { CinemaosClient } from './client.js';
import type { ContentType } from './types.js';

function printHelp() {
  console.log(`
${pc.bold(pc.cyan('🎬 CinemaOS Stream & Subtitle Resolver CLI'))}

${pc.bold('USAGE:')}
  ${pc.green('cinemaos-resolver')} ${pc.yellow('<tmdbId>')} [options]
  ${pc.green('npx cinemaos-resolver')} ${pc.yellow('--id 213375 --type tv --season 1 --episode 1')}

${pc.bold('OPTIONS:')}
  ${pc.cyan('-i, --id <number>')}        TMDB ID (Movie or TV series)
  ${pc.cyan('-t, --type <movie|tv>')}    Content type (default: movie, or tv if season/episode provided)
  ${pc.cyan('-s, --season <number>')}    Season number for TV shows (default: 1)
  ${pc.cyan('-e, --episode <number>')}   Episode number for TV shows (default: 1)
  ${pc.cyan('--imdb <imdbId>')}          IMDb ID (optional, auto-resolved via TMDB)
  ${pc.cyan('--token <token>')}          Custom CinemaOS session token (_st)
  ${pc.cyan('--scrapers <list>')}        Comma-separated scrapers (mv, va, vf, vs)
  ${pc.cyan('--json')}                   Output raw JSON response
  ${pc.cyan('-h, --help')}               Show this help message

${pc.bold('EXAMPLES:')}
  ${pc.gray('# Resolve VisionQuest Season 1 Episode 1:')}
  ${pc.green('npx cinemaos-resolver 213375 --type tv -s 1 -e 1')}

  ${pc.gray('# Resolve Fight Club movie:')}
  ${pc.green('npx cinemaos-resolver 550 --type movie')}

  ${pc.gray('# Get raw JSON output:')}
  ${pc.green('npx cinemaos-resolver 213375 -s 1 -e 1 --json')}
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let id: string | undefined;
  let type: ContentType = 'movie';
  let season: number | undefined;
  let episode: number | undefined;
  let imdbId: string | undefined;
  let token: string | undefined;
  let scrapers: string[] | undefined;
  let isJson = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--json') {
      isJson = true;
    } else if (arg === '-i' || arg === '--id') {
      id = args[++i];
    } else if (arg === '-t' || arg === '--type') {
      const val = args[++i];
      if (val === 'tv' || val === 'movie') type = val;
    } else if (arg === '-s' || arg === '--season') {
      season = parseInt(args[++i], 10);
      type = 'tv';
    } else if (arg === '-e' || arg === '--episode') {
      episode = parseInt(args[++i], 10);
      type = 'tv';
    } else if (arg === '--imdb') {
      imdbId = args[++i];
    } else if (arg === '--token') {
      token = args[++i];
    } else if (arg === '--scrapers') {
      scrapers = args[++i]?.split(',').map((s) => s.trim());
    } else if (!arg.startsWith('-') && !id) {
      id = arg;
    }
  }

  if (!id) {
    console.error(pc.red('Error: TMDB ID is required! Use --id <tmdbId> or pass it as first argument.'));
    process.exit(1);
  }

  const client = new CinemaosClient();

  if (!isJson) {
    console.log(pc.bold(pc.cyan('\n🔍 Resolving CinemaOS streams...')));
    console.log(pc.gray(`TMDB ID: ${id} | Type: ${type}${type === 'tv' ? ` | S${season || 1}E${episode || 1}` : ''}`));
  }

  const result = await client.resolve(
    {
      type,
      tmdbId: id,
      imdbId,
      seasonId: season,
      episodeId: episode,
    },
    { token, scrapers }
  );

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.success || result.sources.length === 0) {
    console.log(pc.red('\n❌ No streams could be resolved from CinemaOS relay scrapers.'));
    process.exit(1);
  }

  console.log(pc.green(`\n✔ Successfully resolved ${result.sources.length} stream(s) and ${result.subtitles.length} subtitle(s)!`));
  console.log(pc.bold(`Title: ${pc.yellow(result.title)} ${result.imdbId ? pc.gray(`(${result.imdbId})`) : ''}`));

  console.log(pc.bold('\n📡 Available Streams:'));
  result.sources.forEach((src, idx) => {
    const is4k = src.quality?.includes('2160') || src.quality?.includes('4K');
    const badge = is4k ? pc.bgMagenta(' 4K UHD ') : pc.bgBlue(` ${src.quality || '1080p'} `);
    const typeBadge = src.type === 'mpd' ? pc.bgYellow(pc.black(' DASH ')) : pc.bgGreen(pc.black(' HLS '));
    console.log(`  ${pc.bold(pc.white(`[${idx + 1}]`))} ${badge} ${typeBadge} ${pc.bold(src.label)}`);
    console.log(`      ${pc.gray('URL:')} ${pc.cyan(src.url)}`);
    console.log(`      ${pc.gray('Relay:')} Scraper: ${src.scraper} | Server: ${src.server}`);
  });

  if (result.subtitles.length > 0) {
    console.log(pc.bold('\n💬 Subtitles:'));
    result.subtitles.forEach((sub) => {
      const isIndo = sub.isIndonesian;
      const tag = isIndo ? pc.bgRed(pc.white(' ID (Indo) ')) : pc.bgBlack(pc.white(` ${sub.lang.toUpperCase()} `));
      console.log(`  ${tag} ${pc.white(sub.label)}: ${pc.gray(sub.file)}`);
    });
  }
  console.log('');
}

main().catch((err) => {
  console.error(pc.red('\nFatal error:'), err);
  process.exit(1);
});
