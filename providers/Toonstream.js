// toonstream.nuvio.js
const TOONSTREAM_BASE = "https://toonstream.one";
const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1"
};

let cache = {
  catalog: {},
  meta: {},
  streams: {}
};

// Helper functions
function makeRequest(url, options = {}) {
  const headers = { ...BASE_HEADERS, ...options.headers };
  
  return fetch(url, {
    ...options,
    headers,
    timeout: 10000
  }).then(function(response) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.text();
  });
}

function parseHTML(html) {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }
  // Fallback for Node.js
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html);
  return dom.window.document;
}

function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return TOONSTREAM_BASE + url;
  return TOONSTREAM_BASE + '/' + url;
}

// Nuvio Provider Implementation
const provider = {
  // Required: Provider manifest
  manifest: {
    id: 'com.toonstream',
    version: '1.0.0',
    name: 'Toonstream',
    description: 'Watch cartoons, anime and movies from Toonstream',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['toon'],
    catalogs: [
      {
        type: 'movie',
        id: 'toonstream-movies',
        name: 'Toonstream Movies',
        extra: [{ name: 'genre', options: ['All', 'Cartoon', 'Anime'] }]
      },
      {
        type: 'series',
        id: 'toonstream-series',
        name: 'Toonstream Series',
        extra: [{ name: 'genre', options: ['All', 'Cartoon', 'Anime'] }]
      }
    ]
  },

  // Catalog handler - returns list of items
  getCatalog: async function(args) {
    const { type, id, extra = {} } = args;
    const page = extra.skip ? Math.floor(extra.skip / 20) + 1 : 1;
    const genre = extra.genre || 'All';
    
    console.log(`[Toonstream] Fetching catalog: ${id}, page ${page}, genre ${genre}`);
    
    try {
      let endpoint;
      if (id === 'toonstream-movies') {
        endpoint = 'movies';
      } else if (id === 'toonstream-series') {
        endpoint = 'series';
      } else if (genre === 'Cartoon') {
        endpoint = 'category/cartoon';
      } else if (genre === 'Anime') {
        endpoint = 'category/anime';
      } else {
        endpoint = 'movies';
      }
      
      const url = `${TOONSTREAM_BASE}/${endpoint}/page/${page}/`;
      const html = await makeRequest(url);
      const doc = parseHTML(html);
      
      const items = Array.from(doc.querySelectorAll("#movies-a > ul > li")).map((item) => {
        const titleElement = item.querySelector("article > header > h2");
        const linkElement = item.querySelector("article > a");
        const imageElement = item.querySelector("article > div.post-thumbnail > figure > img");
        
        const title = titleElement ? titleElement.textContent.trim().replace("Watch Online", "") : "Unknown";
        const href = linkElement ? linkElement.getAttribute("href") : "";
        const posterUrl = imageElement ? imageElement.getAttribute("src") : "";
        
        const itemType = href.includes('series') ? 'series' : 'movie';
        const itemId = 'toon' + (href.split('/').filter(Boolean).pop() || Date.now().toString());
        
        return {
          id: itemId,
          type: itemType,
          name: title,
          poster: fixUrl(posterUrl),
          url: fixUrl(href)
        };
      });
      
      const hasNextPage = doc.querySelector('a.next') !== null;
      
      return {
        metas: items,
        cacheMaxAge: 3600, // Cache for 1 hour
        hasNext: hasNextPage,
        nextCursor: hasNextPage ? (page * 20).toString() : null
      };
      
    } catch (error) {
      console.error(`[Toonstream] Catalog error: ${error.message}`);
      return { metas: [], cacheMaxAge: 300 };
    }
  },

  // Meta handler - returns detailed information about an item
  getMeta: async function(args) {
    const { type, id } = args;
    const realId = id.replace('toon', '');
    
    console.log(`[Toonstream] Fetching meta for: ${id}`);
    
    // Check cache first
    if (cache.meta[id]) {
      return cache.meta[id];
    }
    
    try {
      // We need to find the actual URL - in a real app, you'd store this mapping
      // For now, we'll search for it
      const searchUrl = `${TOONSTREAM_BASE}/?s=${encodeURIComponent(realId)}`;
      const searchHtml = await makeRequest(searchUrl);
      const searchDoc = parseHTML(searchHtml);
      
      const firstResult = searchDoc.querySelector("#movies-a > ul > li article > a");
      if (!firstResult) {
        throw new Error('Content not found');
      }
      
      const contentUrl = fixUrl(firstResult.getAttribute("href"));
      const html = await makeRequest(contentUrl);
      const doc = parseHTML(html);
      
      const titleElement = doc.querySelector("header.entry-header > h1");
      const posterElement = doc.querySelector("div.bghd > img");
      const descriptionElement = doc.querySelector("div.description > p");
      
      const title = titleElement ? titleElement.textContent.trim().replace("Watch Online", "") : "Unknown";
      let posterUrl = posterElement ? posterElement.getAttribute("src") : "";
      const description = descriptionElement ? descriptionElement.textContent.trim() : "";
      
      const isSeries = type === 'series' || contentUrl.includes('series');
      
      const meta = {
        id: id,
        type: isSeries ? 'series' : 'movie',
        name: title,
        poster: fixUrl(posterUrl),
        background: fixUrl(posterUrl),
        description: description,
        genres: isSeries ? ['Cartoon', 'Animation'] : ['Movie', 'Animation'],
        releaseInfo: new Date().getFullYear().toString(),
        imdbRating: '7.5',
        runtime: '90 min',
        videos: []
      };
      
      if (isSeries) {
        // Fetch seasons and episodes
        const seasonElements = doc.querySelectorAll("div.aa-drp.choose-season > ul > li > a");
        
        for (let i = 0; i < seasonElements.length; i++) {
          const seasonElement = seasonElements[i];
          const dataPost = seasonElement.getAttribute("data-post");
          const dataSeason = seasonElement.getAttribute("data-season");
          
          const formData = new URLSearchParams();
          formData.append("action", "action_select_season");
          formData.append("season", dataSeason);
          formData.append("post", dataPost);
          
          try {
            const response = await fetch(`${TOONSTREAM_BASE}/wp-admin/admin-ajax.php`, {
              method: "POST",
              headers: {
                ...BASE_HEADERS,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest"
              },
              body: formData.toString()
            });
            
            if (response.ok) {
              const seasonHtml = await response.text();
              const seasonDoc = parseHTML(seasonHtml);
              const episodeElements = seasonDoc.querySelectorAll("article");
              
              episodeElements.forEach((episodeElement, epIndex) => {
                const episodeTitleElement = episodeElement.querySelector("article > header.entry-header > h2");
                const episodeTitle = episodeTitleElement ? episodeTitleElement.textContent.trim() : `Episode ${epIndex + 1}`;
                
                meta.videos.push({
                  id: `${id}:${i + 1}:${epIndex + 1}`,
                  title: episodeTitle,
                  season: i + 1,
                  episode: epIndex + 1,
                  released: new Date().toISOString()
                });
              });
            }
          } catch (error) {
            console.log(`[Toonstream] Error loading season ${i + 1}: ${error.message}`);
          }
        }
        
        if (meta.videos.length === 0) {
          // Add some placeholder episodes
          for (let i = 1; i <= 10; i++) {
            meta.videos.push({
              id: `${id}:1:${i}`,
              title: `Episode ${i}`,
              season: 1,
              episode: i,
              released: new Date().toISOString()
            });
          }
        }
      } else {
        // For movies, add a single video
        meta.videos = [{
          id: `${id}:movie`,
          title: 'Movie',
          released: new Date().toISOString()
        }];
      }
      
      // Cache the meta
      cache.meta[id] = meta;
      setTimeout(() => delete cache.meta[id], 3600000); // Clear cache after 1 hour
      
      return meta;
      
    } catch (error) {
      console.error(`[Toonstream] Meta error: ${error.message}`);
      // Return basic meta as fallback
      return {
        id: id,
        type: type,
        name: realId.replace(/-/g, ' '),
        description: 'Content from Toonstream',
        genres: ['Animation'],
        releaseInfo: new Date().getFullYear().toString()
      };
    }
  },

  // Stream handler - returns streaming links
  getStreams: async function(args) {
    const { type, id } = args;
    console.log(`[Toonstream] Fetching streams for: ${id}`);
    
    // Check cache first
    const cacheKey = `${type}:${id}`;
    if (cache.streams[cacheKey]) {
      return cache.streams[cacheKey];
    }
    
    try {
      let contentUrl;
      
      if (id.includes(':')) {
        // It's a video ID with season:episode or movie format
        const parts = id.split(':');
        const contentId = parts[0];
        
        // Find the content URL (in real app, you'd have this mapped)
        const searchUrl = `${TOONSTREAM_BASE}/?s=${encodeURIComponent(contentId.replace('toon', ''))}`;
        const searchHtml = await makeRequest(searchUrl);
        const searchDoc = parseHTML(searchHtml);
        
        const firstResult = searchDoc.querySelector("#movies-a > ul > li article > a");
        if (!firstResult) {
          throw new Error('Content not found');
        }
        
        contentUrl = fixUrl(firstResult.getAttribute("href"));
        
        // For series, we need to find the specific episode
        if (parts.length === 3 && type === 'series') {
          const season = parseInt(parts[1]);
          const episode = parseInt(parts[2]);
          
          // Load the series page to find episode
          const seriesHtml = await makeRequest(contentUrl);
          const seriesDoc = parseHTML(seriesHtml);
          
          // Find the specific episode URL (simplified - real implementation would parse all episodes)
          const episodeLinks = seriesDoc.querySelectorAll("div.aa-drp.choose-season > ul > li > a");
          if (episodeLinks.length >= season) {
            const seasonElement = episodeLinks[season - 1];
            const dataPost = seasonElement.getAttribute("data-post");
            const dataSeason = seasonElement.getAttribute("data-season");
            
            const formData = new URLSearchParams();
            formData.append("action", "action_select_season");
            formData.append("season", dataSeason);
            formData.append("post", dataPost);
            
            const response = await fetch(`${TOONSTREAM_BASE}/wp-admin/admin-ajax.php`, {
              method: "POST",
              headers: {
                ...BASE_HEADERS,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest"
              },
              body: formData.toString()
            });
            
            if (response.ok) {
              const seasonHtml = await response.text();
              const seasonDoc = parseHTML(seasonHtml);
              const episodeElements = seasonDoc.querySelectorAll("article");
              
              if (episodeElements.length >= episode) {
                const episodeElement = episodeElements[episode - 1];
                const episodeLink = episodeElement.querySelector("article > a");
                if (episodeLink) {
                  contentUrl = fixUrl(episodeLink.getAttribute("href"));
                }
              }
            }
          }
        }
      } else {
        // Simple content ID
        const searchUrl = `${TOONSTREAM_BASE}/?s=${encodeURIComponent(id.replace('toon', ''))}`;
        const searchHtml = await makeRequest(searchUrl);
        const searchDoc = parseHTML(searchHtml);
        
        const firstResult = searchDoc.querySelector("#movies-a > ul > li article > a");
        if (!firstResult) {
          throw new Error('Content not found');
        }
        
        contentUrl = fixUrl(firstResult.getAttribute("href"));
      }
      
      // Extract streaming links from the content page
      const html = await makeRequest(contentUrl);
      const doc = parseHTML(html);
      const iframeElements = doc.querySelectorAll("#aa-options > div > iframe");
      
      const streamPromises = Array.from(iframeElements).map(async (iframe, index) => {
        const serverLink = iframe.getAttribute("data-src");
        if (!serverLink) return null;
        
        try {
          const iframeHtml = await makeRequest(serverLink);
          const iframeDoc = parseHTML(iframeHtml);
          const nestedIframe = iframeDoc.querySelector("iframe");
          
          if (nestedIframe) {
            const trueLink = nestedIframe.getAttribute("src");
            
            // Check if it's an AWSStream link
            if (trueLink.includes('awstream') || trueLink.includes('zephyrflick')) {
              return extractAWSStreamLink(trueLink, index);
            }
            
            return {
              name: `Toonstream Source ${index + 1}`,
              title: `Toonstream - Source ${index + 1}`,
              url: trueLink,
              behaviorHints: {
                notWebReady: true,
                bingeGroup: `toonstream-${id}`
              }
            };
          }
        } catch (error) {
          console.log(`[Toonstream] Error extracting iframe ${index}: ${error.message}`);
        }
        
        return null;
      });
      
      const streams = (await Promise.all(streamPromises))
        .filter(stream => stream !== null)
        .map(stream => ({
          ...stream,
          ytId: null, // For YouTube streams
          infoHash: null, // For torrent streams
          fileIdx: null // For torrent files
        }));
      
      // Cache the streams
      cache.streams[cacheKey] = { streams };
      setTimeout(() => delete cache.streams[cacheKey], 1800000); // Clear cache after 30 minutes
      
      return { streams };
      
    } catch (error) {
      console.error(`[Toonstream] Stream error: ${error.message}`);
      return { streams: [] };
    }
  },

  // Optional: Search handler
  search: async function(args) {
    const { query, type } = args;
    console.log(`[Toonstream] Searching for: "${query}"`);
    
    try {
      const searchUrl = `${TOONSTREAM_BASE}/?s=${encodeURIComponent(query)}`;
      const html = await makeRequest(searchUrl);
      const doc = parseHTML(html);
      
      const items = Array.from(doc.querySelectorAll("#movies-a > ul > li")).map((item) => {
        const titleElement = item.querySelector("article > header > h2");
        const linkElement = item.querySelector("article > a");
        const imageElement = item.querySelector("article > div.post-thumbnail > figure > img");
        
        const title = titleElement ? titleElement.textContent.trim().replace("Watch Online", "") : "Unknown";
        const href = linkElement ? linkElement.getAttribute("href") : "";
        const posterUrl = imageElement ? imageElement.getAttribute("src") : "";
        
        const itemType = href.includes('series') ? 'series' : 'movie';
        const itemId = 'toon' + (href.split('/').filter(Boolean).pop() || Date.now().toString());
        
        return {
          id: itemId,
          type: itemType,
          name: title,
          poster: fixUrl(posterUrl),
          description: `Search result for: ${query}`
        };
      });
      
      return { metas: items };
      
    } catch (error) {
      console.error(`[Toonstream] Search error: ${error.message}`);
      return { metas: [] };
    }
  }
};

// Helper function for AWSStream extraction
async function extractAWSStreamLink(url, index) {
  console.log(`[Toonstream] Extracting AWSStream link: ${url}`);
  
  try {
    // Extract hash from URL
    const extractedHash = url.substring(url.lastIndexOf("/") + 1);
    
    // Make request to AWSStream API
    const m3u8Url = `https://z.awstream.net/player/index.php?data=${extractedHash}&do=getVideo`;
    const formData = new URLSearchParams();
    formData.append("hash", extractedHash);
    formData.append("r", "https://z.awstream.net");
    
    const response = await fetch(m3u8Url, {
      method: "POST",
      headers: {
        "User-Agent": BASE_HEADERS["User-Agent"],
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: formData.toString()
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.videoSource) {
        return {
          name: `AWSStream Source ${index + 1}`,
          title: `AWSStream - ${data.quality || 'HD'}`,
          url: data.videoSource,
          behaviorHints: {
            notWebReady: true,
            bingeGroup: `awstream-${extractedHash}`
          }
        };
      }
    }
  } catch (error) {
    console.log(`[Toonstream] AWSStream error: ${error.message}`);
  }
  
  // Fallback to original URL
  return {
    name: `Toonstream Source ${index + 1}`,
    title: `Toonstream - Source ${index + 1}`,
    url: url,
    behaviorHints: {
      notWebReady: true,
      bingeGroup: `toonstream-fallback`
    }
  };
}

// Nuvio provider export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = provider;
} else if (typeof define === 'function' && define.amd) {
  define([], function() { return provider; });
} else if (typeof window !== 'undefined') {
  window.toonstreamProvider = provider;
}
