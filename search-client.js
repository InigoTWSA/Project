// search-client.js
// Client-side search using free, no-key-required public APIs.
// Drop-in replacement for the server /api/search endpoint.
//
// APIs used:
//   Books / Classics  → Open Library  (openlibrary.org)  — free, no key
//   Manga / Manhwa    → Jikan v4      (api.jikan.moe)    — free, no key
//   Comics            → Open Library  (subject search)   — free, no key

// ─── Public entry point ───────────────────────────────────────────────────────
// Returns { results: [...], parsed: { keywords, source } }
export async function clientSearch(query, source = 'books', limit = 12) {
  if (!query || !query.trim()) return { results: [], parsed: {} };

  const q      = query.trim();
  const parsed = parseQuery(q, source);
  const src    = source === 'books' && parsed.source !== 'books' ? parsed.source : source;

  let results = [];

  try {
    if (src === 'manga') {
      results = await searchJikan(parsed.keywords, limit);
    } else if (src === 'comics') {
      results = await searchOpenLibrarySubject('comics', parsed.keywords, limit);
    } else if (src === 'classics') {
      results = await searchGutenbergRest(parsed.keywords, limit);
    } else if (src === 'all') {
      const [books, manga, classics] = await Promise.allSettled([
        searchOpenLibrary(parsed.keywords, Math.ceil(limit / 3)),
        searchJikan(parsed.keywords, Math.ceil(limit / 3)),
        searchGutenbergRest(parsed.keywords, Math.ceil(limit / 3)),
      ]);
      results = [
        ...(books.status    === 'fulfilled' ? books.value    : []),
        ...(manga.status    === 'fulfilled' ? manga.value    : []),
        ...(classics.status === 'fulfilled' ? classics.value : []),
      ];
    } else {
      // Default: books
      results = await searchOpenLibrary(parsed.keywords, limit);
    }
  } catch (err) {
    console.error('[search-client] error:', err);
  }

  return { results: results.slice(0, limit), parsed };
}

// ─── Simple client-side query parser (no Claude needed) ──────────────────────
function parseQuery(query, forcedSource) {
  const q = query.toLowerCase();
  let source = forcedSource || 'books';

  if (forcedSource === 'books' || !forcedSource) {
    if (/manga|manhwa|manhua|webtoon|anime|shonen|shojo|seinen|isekai/i.test(q))
      source = 'manga';
    else if (/comic|graphic novel|marvel|dc comics|batman|superman|spider.?man/i.test(q))
      source = 'comics';
    else if (/classic|gutenberg|public domain|dickens|tolstoy|austen|shakespeare/i.test(q))
      source = 'classics';
  }

  // Strip filler words for cleaner API queries
  const keywords = query
    .replace(/\b(find|show|search|give me|recommend|good|best|popular|top)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { keywords, source };
}

// ─── Open Library — general book search ──────────────────────────────────────
async function searchOpenLibrary(keywords, limit = 12) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(keywords)}&limit=${limit}&fields=key,title,author_name,cover_i,first_publish_year,subject,ratings_average,number_of_pages_median`;
  const res  = await fetch(url);
  const data = await res.json();
  const docs = data.docs || [];

  return docs.slice(0, limit).map((d, i) => ({
    id:          `ol-${d.key?.replace('/works/', '') || i}`,
    externalId:  d.key || String(i),
    source:      'open-library',
    sourceLabel: 'Book',
    title:       d.title || 'Unknown Title',
    author:      d.author_name?.[0] || 'Unknown Author',
    cover:       d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    rating:      d.ratings_average ? Math.round(d.ratings_average * 10) / 10 : null,
    year:        d.first_publish_year || null,
    description: null,
  }));
}

// ─── Open Library — subject / genre search (used for comics) ─────────────────
async function searchOpenLibrarySubject(subject, keywords, limit = 12) {
  // Try subject first, then fall back to regular search with subject keyword
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(keywords + ' ' + subject)}&limit=${limit}&fields=key,title,author_name,cover_i,first_publish_year,ratings_average`;
  const res  = await fetch(url);
  const data = await res.json();
  const docs = data.docs || [];

  return docs.slice(0, limit).map((d, i) => ({
    id:          `ol-comic-${d.key?.replace('/works/', '') || i}`,
    externalId:  d.key || String(i),
    source:      'open-library',
    sourceLabel: 'Comics',
    title:       d.title || 'Unknown Title',
    author:      d.author_name?.[0] || 'Unknown Author',
    cover:       d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    rating:      d.ratings_average ? Math.round(d.ratings_average * 10) / 10 : null,
    year:        d.first_publish_year || null,
    description: null,
  }));
}

// ─── Project Gutenberg REST API — public-domain classics ─────────────────────
async function searchGutenbergRest(keywords, limit = 12) {
  const url = `https://gutendex.com/books/?search=${encodeURIComponent(keywords)}&mime_type=image%2F`;
  const res  = await fetch(url);
  const data = await res.json();
  const books = data.results || [];

  return books.slice(0, limit).map((b, i) => ({
    id:            `gutenberg-${b.id || i}`,
    externalId:    String(b.id || i),
    source:        'gutenberg',
    sourceLabel:   'Classic',
    title:         b.title || 'Unknown Title',
    author:        b.authors?.[0]?.name?.replace(/,\s*\d+.*$/, '') || 'Unknown Author',
    cover:         b.formats?.['image/jpeg'] || null,
    rating:        null,
    year:          b.authors?.[0]?.birth_year || null,
    description:   b.subjects?.slice(0, 2).join(', ') || null,
    downloadCount: b.download_count || null,
  }));
}

// ─── Jikan v4 — MyAnimeList manga search ─────────────────────────────────────
async function searchJikan(keywords, limit = 12) {
  const url = `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(keywords)}&limit=${Math.min(limit, 25)}&order_by=popularity&sort=asc`;
  const res  = await fetch(url);
  const data = await res.json();
  const list = data.data || [];

  return list.slice(0, limit).map((m, i) => ({
    id:          `jikan-${m.mal_id || i}`,
    externalId:  String(m.mal_id || i),
    source:      'manga-eden',   // keep same source key so CSS badge colours match
    sourceLabel: m.type === 'Manhwa' ? 'Manhwa' : m.type === 'Manhua' ? 'Manhua' : 'Manga',
    title:       m.title_english || m.title || 'Unknown Title',
    author:      m.authors?.[0]?.name?.replace(/,\s*/, ' ') || 'Unknown Author',
    cover:       m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || null,
    rating:      m.score || null,
    year:        m.published?.prop?.from?.year || null,
    description: m.synopsis ? m.synopsis.slice(0, 200) : null,
    status:      m.status || null,
    chapters:    m.chapters || null,
  }));
}
