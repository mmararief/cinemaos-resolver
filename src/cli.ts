#!/usr/bin/env node

import pc from 'picocolors';
import { CinemaosClient } from './client.js';
import { searchMediaByTitle } from './search.js';
import type { ContentType } from './types.js';

function printHelp() {
  console.log(`
${pc.bold(pc.cyan('🎬 CinemaOS Stream & Subtitle Resolver CLI'))}

${pc.bold('USAGE:')}
  ${pc.green('cinemaos-resolver')} ${pc.yellow('<title | tmdbId>')} [options]
  ${pc.green('npx cinemaos-resolver')} ${pc.yellow('"Breaking Bad" --season 1 --episode 1')}
  ${pc.green('npx cinemaos-resolver')} ${pc.yellow('"Fight Club"')}

${pc.bold('OPTIONS:')}
  ${pc.cyan('-q, --query <title>')}       Search movie or TV series by title
  ${pc.cyan('-i, --id <number>')}         Direct TMDB ID
  ${pc.cyan('-t, --type <movie|tv>')}     Content type (default: auto-detected, or tv if season/episode provided)
  ${pc.cyan('-s, --season <number>')}     Season number for TV shows (default: 1)
  ${pc.cyan('-e, --episode <number>')}    Episode number for TV shows (default: 1)
  ${pc.cyan('--imdb <imdbId>')}           IMDb ID (optional, auto-resolved)
  ${pc.cyan('--token <token>')}           Custom CinemaOS session token (_st)
  ${pc.cyan('--scrapers <list>')}         Comma-separated scrapers (mv, va, vf, vs)
  ${pc.cyan('--json')}                    Output raw JSON response
  ${pc.cyan('-h, --help')}                Show this help message

${pc.bold('EXAMPLES:')}
  ${pc.gray('# Search and resolve by title:')}
  ${pc.green('npx cinemaos-resolver "Breaking Bad" -s 1 -e 1')}
  ${pc.green('npx cinemaos-resolver "Fight Club"')}
  ${pc.green('npx cinemaos-resolver -q "Oppenheimer"')}

  ${pc.gray('# Resolve by direct TMDB ID:')}
  ${pc.green('npx cinemaos-resolver 213375 -s 1 -e 1')}
  ${pc.green('npx cinemaos-resolver 550')}
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let inputQueryOrId: string | undefined;
  let type: ContentType | undefined;
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
    } else if (arg === '-q' || arg === '--query') {
      inputQueryOrId = args[++i];
    } else if (arg === '-i' || arg === '--id') {
      inputQueryOrId = args[++i];
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
    } else if (!arg.startsWith('-') && !inputQueryOrId) {
      inputQueryOrId = arg;
    }
  }

  if (!inputQueryOrId) {
    console.error(pc.red('Error: Title or TMDB ID is required! Use "npx cinemaos-resolver <title>"'));
    process.exit(1);
  }

  let resolvedId = inputQueryOrId.trim();

  // If input is non-numeric, search TMDB by title!
  if (isNaN(Number(resolvedId))) {
    if (!isJson) {
      console.log(pc.gray(`🔎 Searching TMDB for "${resolvedId}"...`));
    }
    const searchResults = await searchMediaByTitle(resolvedId, type);
    if (searchResults.length === 0) {
      console.error(pc.red(`Error: No movies or TV series found matching "${resolvedId}".`));
      process.exit(1);
    }

    const match = searchResults[0];
    resolvedId = String(match.id);
    if (!type) {
      type = match.type;
    }

    if (!isJson) {
      console.log(
        pc.green(
          `✔ Found: ${pc.bold(match.title)} (${match.year || 'N/A'})${
            match.rating ? ` ★ ${match.rating}` : ''
          } [${match.type.toUpperCase()}] (TMDB: ${match.id})`
        )
      );
    }
  } else {
    if (!type) {
      type = season || episode ? 'tv' : 'movie';
    }
  }

  const finalType: ContentType = type || (season || episode ? 'tv' : 'movie');
  const client = new CinemaosClient();

  if (!isJson) {
    console.log(pc.bold(pc.cyan('\n🔍 Resolving CinemaOS streams...')));
    console.log(
      pc.gray(
        `TMDB ID: ${resolvedId} | Type: ${finalType}${
          finalType === 'tv' ? ` | S${season || 1}E${episode || 1}` : ''
        }`
      )
    );
  }

  const result = await client.resolve(
    {
      type: finalType,
      tmdbId: resolvedId,
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
    console.log(pc.red(`\n❌ ${result.error || 'No streams could be resolved from CinemaOS relay scrapers.'}`));
    process.exit(1);
  }

  console.log(
    pc.green(
      `\n✔ Successfully resolved ${result.sources.length} stream(s) and ${result.subtitles.length} subtitle(s)!`
    )
  );
  console.log(
    pc.bold(`Title: ${pc.yellow(result.title)} ${result.imdbId ? pc.gray(`(${result.imdbId})`) : ''}`)
  );

  console.log(pc.bold('\n📡 Available Streams:'));
  result.sources.forEach((src, idx) => {
    const is4k = src.quality?.includes('2160') || src.quality?.includes('4K');
    const badge = is4k ? pc.bgMagenta(' 4K UHD ') : pc.bgBlue(` ${src.quality || '1080p'} `);
    const typeBadge =
      src.type === 'mpd' ? pc.bgYellow(pc.black(' DASH ')) : pc.bgGreen(pc.black(' HLS '));
    console.log(`  ${pc.bold(pc.white(`[${idx + 1}]`))} ${badge} ${typeBadge} ${pc.bold(src.label)}`);
    console.log(`      ${pc.gray('URL:')} ${pc.cyan(src.url)}`);
    console.log(`      ${pc.gray('Relay:')} Scraper: ${src.scraper} | Server: ${src.server}`);
  });

  if (result.subtitles.length > 0) {
    console.log(pc.bold('\n💬 Subtitles:'));
    result.subtitles.forEach((sub) => {
      const isIndo = sub.isIndonesian;
      const tag = isIndo
        ? pc.bgRed(pc.white(' ID (Indo) '))
        : pc.bgBlack(pc.white(` ${sub.lang.toUpperCase()} `));
      console.log(`  ${tag} ${pc.white(sub.label)}: ${pc.gray(sub.file)}`);
    });
  }
  console.log('');
}

main().catch((err) => {
  console.error(pc.red('\nFatal error:'), err);
  process.exit(1);
});
