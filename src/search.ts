export interface SearchResultItem {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  year?: string;
  overview?: string;
  rating?: string;
}

const TMDB_API_KEY =
  process.env.TMDB_API_KEY || 'f7618012b800380f5950c377115d5dbe';

/**
 * Searches movies and TV series by title using TMDB.
 */
export async function searchMediaByTitle(
  query: string,
  filterType?: 'movie' | 'tv'
): Promise<SearchResultItem[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  let endpoint: string;
  if (filterType === 'movie') {
    endpoint = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
      cleanQuery
    )}&include_adult=false`;
  } else if (filterType === 'tv') {
    endpoint = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
      cleanQuery
    )}&include_adult=false`;
  } else {
    endpoint = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
      cleanQuery
    )}&include_adult=false`;
  }

  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];

    const data: any = await res.json();
    if (!Array.isArray(data.results)) return [];

    return data.results
      .filter((r: any) => {
        const itemType = filterType || r.media_type;
        return itemType === 'movie' || itemType === 'tv';
      })
      .map((r: any) => {
        const itemType = filterType || (r.media_type as 'movie' | 'tv');
        const title = r.title || r.name || '';
        const dateStr = r.release_date || r.first_air_date || '';
        const year = dateStr ? dateStr.substring(0, 4) : undefined;
        const rating =
          typeof r.vote_average === 'number' && r.vote_average > 0
            ? r.vote_average.toFixed(1)
            : undefined;

        return {
          id: r.id,
          type: itemType,
          title,
          year,
          overview: r.overview || '',
          rating,
        };
      })
      .slice(0, 10);
  } catch {
    return [];
  }
}
