#!/usr/bin/env node

import * as p from '@clack/prompts';
import pc from 'picocolors';
import open from 'open';
import { CinemaosClient } from './client.js';
import type { ContentType } from './types.js';

async function main() {
  console.clear();
  p.intro(pc.bgMagenta(pc.bold(' 🎬 CinemaOS VIP Stream & Subtitle Explorer ')));

  const client = new CinemaosClient();

  const type = (await p.select({
    message: 'What would you like to watch?',
    options: [
      { value: 'tv', label: '📺 TV Series', hint: 'e.g. VisionQuest, House of the Dragon' },
      { value: 'movie', label: '🍿 Movie', hint: 'e.g. Fight Club, Inception' },
    ],
  })) as ContentType;

  if (p.isCancel(type)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  const defaultId = type === 'tv' ? '213375' : '550';
  const defaultLabel = type === 'tv' ? 'VisionQuest (213375)' : 'Fight Club (550)';

  const idInput = await p.text({
    message: `Enter TMDB ID:`,
    placeholder: defaultId,
    initialValue: defaultId,
    validate: (val) => {
      if (!val || isNaN(Number(val))) return 'Please enter a valid numeric TMDB ID';
    },
  });

  if (p.isCancel(idInput)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  const tmdbId = String(idInput).trim();
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
  s.start(pc.cyan('Decrypting payloads and querying CinemaOS relay scrapers...'));

  const result = await client.resolve({
    type,
    tmdbId,
    seasonId: season,
    episodeId: episode,
  });

  s.stop(pc.green('Resolution complete!'));

  if (!result.success || result.sources.length === 0) {
    p.note(
      result.error || 'Could not find active streams for this title.',
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

  const streamOptions = result.sources.map((src, index) => {
    return {
      value: src.url,
      label: `${src.quality || '1080p'} [${src.type.toUpperCase()}] - ${src.label}`,
      hint: `${src.scraper.toUpperCase()} / ${src.server}`,
    };
  });

  streamOptions.push({
    value: 'EXIT',
    label: '❌ Exit',
    hint: 'Close explorer',
  });

  const selectedStream = await p.select({
    message: 'Select a stream:',
    options: streamOptions,
  });

  if (p.isCancel(selectedStream) || selectedStream === 'EXIT') {
    p.outro('Goodbye!');
    process.exit(0);
  }

  const streamUrl = String(selectedStream);

  const action = await p.select({
    message: 'What do you want to do with this stream?',
    options: [
      { value: 'open', label: '🌐 Open in Web Browser / Player', hint: 'Launch stream URL directly' },
      { value: 'copy', label: '📋 Display URL for copying', hint: 'Print stream link' },
    ],
  });

  if (action === 'open') {
    p.log.info(`Opening stream in default application: ${pc.cyan(streamUrl)}`);
    await open(streamUrl);
  } else {
    p.log.message(`\n${pc.bold('Stream URL:')}\n${pc.cyan(streamUrl)}\n`);
  }

  p.outro(pc.green('Enjoy your stream! ✨'));
}

main().catch((err) => {
  console.error(pc.red('Fatal error:'), err);
  process.exit(1);
});
