// api/search.js - NLP-powered unified search across all book sources

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q, source } = req.query;
  if (!q || !q.trim()) return res.status(400).json({ error: 'Query is required' });

  try {
    // Step 1: Use Claude to parse natural language into structured search params
    const parsed = await parseWithClaude(q.trim());
    const targetSource = source || parsed.source;

    // Step 2: Fan out to the right API(s)
    let results = [];

    if (targetSource === 'manga') {
      results = await searchMangaEden(parsed.keywords);
    } else if (targetSource === 'comics') {
      results = await searchComicVine(parsed.keywords);
    } else if (targetSource === 'classics') {
      results = await searchGutenberg(parsed.keywords);
    } else if (targetSource === 'harvard') {
      results = await searchHarvard(parsed.keywords);
    } else if (targetSource === 'all') {
      // Fan out to all sources in parallel, merge results
      const [books, manga, comics, classics] = await Promise.allSettled([
        searchHardcover(parsed.keywords),
        searchMangaEden(parsed.keywords),
        searchComicVine(parsed.keywords),
        searchGutenberg(parsed.keywords),
      ]);
      results = [
        ...(books.status === 'fulfilled' ? books.value : []),
        ...(manga.status === 'fulfilled' ? manga.value : []),
        ...(comics.status === 'fulfilled' ? comics.value : []),
        ...(classics.status === 'fulfilled' ? classics.value : []),
      ];
    } else {
      // Default: Hardcover for books
      results = await searchHardcover(parsed.keywords);
    }

    return res.json({ results, parsed });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Search failed', detail: err.message });
  }
}

// ─── NLP Parser via Claude ────────────────────────────────────────────────────

async function parseWithClaude(query) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: `You are a search query parser for a book/manga/comics tracking app.
Given a natural language search query, extract structured search parameters.
Respond ONLY with valid JSON, no markdown, no explanation.
JSON shape:
{
  "keywords": "clean search keywords for API query",
  "source": "books|manga|comics|classics|harvard|all",
  "genre": "genre if mentioned or null",
  "mood": "mood/theme if mentioned or null",
  "intent": "discovery|lookup"
}
Rules:
- "source" = "manga" if query mentions manga, manhwa, manhua, webtoon, or Japanese/Korean comics
- "source" = "comics" if query mentions comics, comic books, DC, Marvel, graphic novel
- "source" = "classics" if query mentions classic, public domain, old, historical literature
- "source" = "harvard" if query mentions academic, scholarly, research, rare, historical
- "source" = "all" if query is vague or mentions multiple types
- "source" = "books" otherwise (default)
- "intent" = "lookup" if user is searching for a specific title/author
- "intent" = "discovery" if user is browsing by mood, genre, or description
- "keywords" should be clean API-friendly search terms extracted from the query`,
      messages: [{ role: 'user', content: query }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    // Fallback if Claude returns unexpected format
    return { keywords: query, source: 'books', intent: 'discovery' };
  }
}

// ─── Hardcover (GraphQL) ──────────────────────────────────────────────────────

async function searchHardcover(keywords) {
  const query = `
    query SearchBooks($query: String!) {
      search(query: $query, query_type: "Book", per_page: 12) {
        results {
          ... on Book {
            id
            title
            slug
            contributions { author { name } }
            image { url }
            rating
            users_read_count
            release_year
            description
          }
        }
      }
    }
  `;

  const response = await fetch('https://api.hardcover.app/v1/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.HARDCOVER_TOKEN,
    },
    body: JSON.stringify({ query, variables: { query: keywords } }),
  });

  const data = await response.json();
  const books = data?.data?.search?.results || [];

  return books.map(b => ({
    id: `hardcover-${b.id}`,
    externalId: String(b.id),
    source: 'hardcover',
    title: b.title || 'Unknown Title',
    author: b.contributions?.[0]?.author?.name || 'Unknown Author',
    cover: b.image?.url || null,
    rating: b.rating || null,
    year: b.release_year || null,
    description: b.description || null,
    sourceLabel: 'Book',
  }));
}

// ─── Manga Eden (RapidAPI) ────────────────────────────────────────────────────

async function searchMangaEden(keywords) {
  const url = `https://community-manga-eden.p.rapidapi.com/list?keyword=${encodeURIComponent(keywords)}&page=1&count=12`;

  const response = await fetch(url, {
    headers: {
      'x-rapidapi-host': 'community-manga-eden.p.rapidapi.com',
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
    },
  });

  const data = await response.json();
  const list = data?.manga || data?.data || data || [];

  return (Array.isArray(list) ? list : []).slice(0, 12).map(m => ({
    id: `manga-${m.i || m.id}`,
    externalId: String(m.i || m.id),
    source: 'manga-eden',
    title: m.t || m.title || 'Unknown Title',
    author: m.a?.[0] || m.author || 'Unknown Author',
    cover: m.im ? `https://cdn.mangaeden.com/mangasimg/${m.im}` : null,
    rating: m.r || null,
    year: null,
    description: null,
    sourceLabel: 'Manga',
    status: m.s === 1 ? 'Ongoing' : m.s === 2 ? 'Completed' : null,
    lastChapter: m.lc || null,
  }));
}

// ─── Comic Vine ───────────────────────────────────────────────────────────────

async function searchComicVine(keywords) {
  const url = `https://comicvine.gamespot.com/api/search/?api_key=${process.env.COMICVINE_API_KEY}&format=json&query=${encodeURIComponent(keywords)}&resources=volume&field_list=id,name,deck,image,publisher,count_of_issues,start_year&limit=12`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'PageSync/1.0' },
  });

  const data = await response.json();
  const results = data?.results || [];

  return results.map(c => ({
    id: `comicvine-${c.id}`,
    externalId: String(c.id),
    source: 'comic-vine',
    title: c.name || 'Unknown Title',
    author: c.publisher?.name || 'Unknown Publisher',
    cover: c.image?.medium_url || c.image?.small_url || null,
    rating: null,
    year: c.start_year || null,
    description: c.deck || null,
    sourceLabel: 'Comics',
    issueCount: c.count_of_issues || null,
  }));
}

// ─── Project Gutenberg (RapidAPI) ─────────────────────────────────────────────

async function searchGutenberg(keywords) {
  const url = `https://project-gutenberg-free-books-api1.p.rapidapi.com/api/books?q=${encodeURIComponent(keywords)}`;

  const response = await fetch(url, {
    headers: {
      'x-rapidapi-host': 'project-gutenberg-free-books-api1.p.rapidapi.com',
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
    },
  });

  const data = await response.json();
  const books = data?.results || data?.books || data || [];

  return (Array.isArray(books) ? books : []).slice(0, 12).map(b => ({
    id: `gutenberg-${b.id}`,
    externalId: String(b.id),
    source: 'gutenberg',
    title: b.title || 'Unknown Title',
    author: b.authors?.[0]?.name || b.author || 'Unknown Author',
    cover: b.formats?.['image/jpeg'] || null,
    rating: null,
    year: b.copyright || null,
    description: null,
    sourceLabel: 'Classic',
    downloadCount: b.download_count || null,
  }));
}

// ─── Harvard LibraryCloud ─────────────────────────────────────────────────────

async function searchHarvard(keywords) {
  const url = `https://api.lib.harvard.edu/v2/items.json?q=${encodeURIComponent(keywords)}&limit=12&sort.field=relevance`;

  const response = await fetch(url);
  const data = await response.json();
  const items = data?.items?.mods || [];

  return (Array.isArray(items) ? items : [items]).slice(0, 12).map((item, i) => {
    const title = typeof item.titleInfo?.title === 'string'
      ? item.titleInfo.title
      : item.titleInfo?.title?.['#text'] || 'Unknown Title';

    const author = typeof item.name?.namePart === 'string'
      ? item.name.namePart
      : Array.isArray(item.name?.namePart)
        ? item.name.namePart[0]
        : 'Unknown Author';

    const year = item.originInfo?.dateIssued?.['#text']
      || item.originInfo?.dateIssued
      || null;

    return {
      id: `harvard-${i}-${Date.now()}`,
      externalId: item.recordInfo?.recordIdentifier?.['#text'] || String(i),
      source: 'harvard',
      title,
      author,
      cover: null,
      rating: null,
      year,
      description: null,
      sourceLabel: 'Academic',
    };
  });
}
