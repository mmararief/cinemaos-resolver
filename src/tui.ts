#!/usr/bin/env node

import * as p from '@clack/prompts';
import pc from 'picocolors';
import open from 'open';
import { CinemaosClient } from './client.js';
import { searchMediaByTitle, type SearchResultItem } from './search.js';
import type { ContentType } from './types.js';

async function main() {
  console.clear();
  p.intro(pc.bgMagenta(pc.bold(' 🎬 CinemaOS VIP Stream & Subtitle Explorer ')));

  const client = new CinemaosClient();

  let selectedItem: SearchResultItem | null = null;

  while (!selectedItem) {
    const query = await p.text({
      message: 'Enter Movie or TV Show Title:',
      placeholder: 'e.g. Fight Club, Breaking Bad, Inception, Avatar',
      validate: (val) => {
        if (!val || val.trim().length === 0) return 'Please enter a title to search';
      },
    });

    if (p.isCancel(query)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    const s = p.spinner();
    s.start(pc.cyan(`Searching TMDB for "${query}"...`));
    const results = await searchMediaByTitle(String(query).trim());
    s.stop(pc.green(`Found ${results.length} result(s)`));

    if (results.length === 0) {
      p.note(pc.yellow(`No movies or TV shows found matching "${query}". Try again.`));
      continue;
    }

    const choices = [
      ...results.map((item) => ({
        value: item,
        label: `${item.type === 'tv' ? '📺' : '🍿'} ${item.title} (${item.year || 'N/A'})${
          item.rating ? pc.yellow(` ★ ${item.rating}`) : ''
        }`,
        hint: item.overview ? item.overview.slice(0, 65) + '...' : undefined,
      })),
      {
        value: 'retry' as any,
        label: '🔍 Search for a different title',
      },
    ];

    const pick = await p.select({
      message: 'Select title to resolve:',
      options: choices,
    });

    if (p.isCancel(pick)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    if (pick !== 'retry') {
      selectedItem = pick as SearchResultItem;
    }
  }

  const type: ContentType = selectedItem.type;
  const tmdbId = String(selectedItem.id);
  let season = 1;
  let episode = 1;

  if (type === 'tv') {
    const sInput = await p.text({
      message: 'Enter Season number:',
      placeholder: '1',
      initialValue: '1',
      validate: (val) => {
        if (!val || isNaN(Number(val)) || Number(val) < 1) return 'Season must be >= 1';
      },
    });
    if (p.isCancel(sInput)) return process.exit(0);
    season = Number(sInput);

    const eInput = await p.text({
      message: 'Enter Episode number:',
      placeholder: '1',
      initialValue: '1',
      validate: (val) => {
        if (!val || isNaN(Number(val)) || Number(val) < 1) return 'Episode must be >= 1';
      },
    });
    if (p.isCancel(eInput)) return process.exit(0);
    episode = Number(eInput);
  }

  const s = p.spinner();
  s.start(pc.cyan(`Resolving streams for "${selectedItem.title}"...`));

  const result = await client.resolve({
    type,
    tmdbId,
    seasonId: season,
    episodeId: episode,
  });

  s.stop(pc.green('Resolution complete!'));

  if (!result.success || result.sources.length === 0) {
    p.note(
      result.error || 'Could not find active streams for this title on CinemaOS.',
      pc.red('No Streams Found')
    );
    p.outro(pc.yellow('Exiting.'));
    return;
  }

  p.note(
    `Title: ${pc.bold(result.title)} ${result.imdbId ? `(${result.imdbId})` : ''}\n` +
      `Streams: ${pc.cyan(result.sources.length)} available\n` +
      `Subtitles: ${pc.yellow(result.subtitles.length)} tracks (including Indonesian)`,
    pc.green('✔ Resolved Successfully')
  );

  // Subtitle preview
  const indoSubs = result.subtitles.filter((sub) => sub.isIndonesian);
  if (indoSubs.length > 0) {
    p.log.success(
      `Found ${pc.bold(indoSubs.length)} Indonesian subtitle(s): ${pc.cyan(
        indoSubs.map((s) => s.label).join(', ')
      )}`
    );
  }

  // Interactive Stream Action
  const streamOptions = result.sources.map((src, i) => {
    const is4k = src.quality?.includes('2160') || src.quality?.includes('4K');
    const badge = is4k ? pc.bgMagenta(' 4K ') : pc.bgBlue(` ${src.quality || '1080p'} `);
    const typeBadge = src.type === 'mpd' ? pc.bgYellow(pc.black(' DASH ')) : pc.bgGreen(pc.black(' HLS '));
    const audioBadge = src.audio ? pc.bgCyan(pc.black(` 🔊 ${src.audio} `)) : '';
    return {
      value: src,
      label: `[${i + 1}] ${badge} ${typeBadge} ${audioBadge} ${src.label}`,
      hint: `${src.scraper.toUpperCase()} • ${src.server}`,
    };
  });

  const selectedStream: any = await p.select({
    message: 'Select a stream server to inspect or play:',
    options: [
      ...streamOptions,
      { value: 'subtitles', label: '💬 View all available subtitle tracks' },
      { value: 'exit', label: '❌ Exit' },
    ] as any,
  });

  if (p.isCancel(selectedStream) || selectedStream === 'exit') {
    p.outro(pc.yellow('Goodbye!'));
    process.exit(0);
  }

  if (selectedStream === 'subtitles') {
    console.clear();
    p.intro(pc.bgBlue(pc.bold(` Subtitle Tracks for ${result.title} `)));
    result.subtitles.forEach((sub, idx) => {
      const tag = sub.isIndonesian
        ? pc.bgRed(pc.white(' ID (Indo) '))
        : pc.bgBlack(pc.white(` ${sub.lang.toUpperCase()} `));
      console.log(`  [${idx + 1}] ${tag} ${pc.white(sub.label)}: ${pc.cyan(sub.file)}`);
    });
    p.outro(pc.green('Done listing subtitles.'));
    return;
  }

  const action = await p.select({
    message: `Stream selected: ${selectedStream.label}`,
    options: [
      { value: 'copy', label: '📋 Print direct stream URL to terminal' },
      { value: 'browser', label: '🌐 Open proxy player in default browser' },
      { value: 'vlc', label: '📺 Copy VLC network stream command' },
      { value: 'exit', label: '❌ Cancel' },
    ],
  });

  if (action === 'copy') {
    console.log(pc.bold('\nStream URL:'));
    console.log(pc.cyan(selectedStream.url));
  } else if (action === 'browser') {
    const playerUrl = `https://stream-player.pages.dev/?url=${encodeURIComponent(
      selectedStream.url
    )}`;
    p.log.info(`Opening stream player: ${playerUrl}`);
    await open(playerUrl);
  } else if (action === 'vlc') {
    console.log(pc.bold('\nVLC Command:'));
    console.log(
      pc.green(
        `vlc --http-referrer="https://cinemaos.live/" "${selectedStream.url}"`
      )
    );
  }

  p.outro(pc.green('✨ Enjoy your stream!'));
}

main().catch((err) => {
  p.outro(pc.red(`Error: ${err.message}`));
  process.exit(1);
});
