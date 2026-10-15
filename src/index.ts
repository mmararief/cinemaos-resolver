export { CinemaosClient, KNOWN_CINEMAOS_TOKENS, DEFAULT_SCRAPERS } from './client.js';
export * from './types.js';
export * from './crypto.js';

import { CinemaosClient } from './client.js';

// Default global instance for convenience
const defaultClient = new CinemaosClient();

export const resolve = defaultClient.resolve.bind(defaultClient);
export const resolveMovie = defaultClient.resolveMovie.bind(defaultClient);
export const resolveEpisode = defaultClient.resolveEpisode.bind(defaultClient);
export const resolveMetadata = defaultClient.resolveMetadata.bind(defaultClient);

export default defaultClient;
