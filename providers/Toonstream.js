console.log("[Toonstream] Initializing Toonstream provider");

const BASE_URL = "https://toonstream.one";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// Add JSDOM for Node.js environment
const { JSDOM } = require('jsdom');

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL
};

async function makeRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
    timeout: 10000
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response;
}

/* ---------------- TMDB ---------------- */

async function getTmdbTitle(tmdbId, mediaType) {
  const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const response = await makeRequest(url);
  const data = await response.json();
  
  return {
    title: mediaType === "tv" ? data.name : data.title,
    year: mediaType === "tv" ? 
      (data.first_air_date || "").substring(0, 4) : 
      (data.release_date || "").substring(0, 4)
  };
}

/* ---------------- SEARCH ---------------- */

function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  const s2 = str2.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  
  if (s1 === s2) return 1;
  
  const words1 = s1.split(/\s+/).filter(w => w.length > 0);
  const words2 = s2.split(/\s+/).filter(w => w.length > 0);
  
  let matches = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1.includes(word2) || word2.includes(word1)) {
        matches++;
        break;
      }
    }
  }
  
  return matches / Math.max(words1.length, words2.length);
}

async function searchToonstream(query, year = null) {
  const results = [];
  const searchQueries = year ? [`${query} ${year}`, query] : [query];
  
  for (const searchQuery of searchQueries) {
    for (let page = 1; page <= 3; page++) {
      try {
        const url = `${BASE_URL}/page/${page}/?s=${encodeURIComponent(searchQuery)}`;
        const response = await makeRequest(url);
        const html = await response.text();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        const items = doc.querySelectorAll("#movies-a > ul > li");
        
        if (items.length === 0 && page === 1) {
          break; // No results on first page
        }

        items.forEach(el => {
          const titleEl = el.querySelector("article header h2");
          const linkEl = el.querySelector("article > a");
          const imgEl = el.querySelector("article img");
          
          if (titleEl && linkEl) {
            const title = titleEl.textContent
              .replace("Watch Online", "")
              .trim();
            const href = linkEl.href;
            const poster = imgEl ? 
              (imgEl.src.startsWith("http") ? imgEl.src : `https:${imgEl.src}`) : 
              null;
              
            const similarity = calculateSimilarity(title, query);
            
            if (similarity >= 0.3) { // Lower threshold for cartoons/anime
              results.push({ 
                title, 
                url: href,
                poster,
                similarity 
              });
            }
          }
        });

        if (items.length < 10) break; // Last page

      } catch (error) {
        console.error(`[Toonstream] Search page ${page} error:`, error.message);
        break;
      }
    }
    
    if (results.length > 0) break; // Found results with this query
  }
  
  // Sort by similarity
  return results.sort((a, b) => b.similarity - a.similarity);
}

/* ---------------- LOAD EPISODES ---------------- */

async function loadEpisodes(seriesUrl) {
  const response = await makeRequest(seriesUrl);
  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const episodes = [];
  const seasonNodes = doc.querySelectorAll("div.aa-drp.choose-season ul li a");

  for (const season of seasonNodes) {
    const postId = season.getAttribute("data-post");
    const seasonId = season.getAttribute("data-season");
    const seasonName = season.textContent.trim();

    const formData = new URLSearchParams({
      action: "action_select_season",
      season: seasonId,
      post: postId,
    });

    try {
      const seasonResponse = await makeRequest(`${BASE_URL}/wp-admin/admin-ajax.php`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: formData.toString(),
      });

      const seasonHtml = await seasonResponse.text();
      const seasonDom = new JSDOM(seasonHtml);
      const seasonDoc = seasonDom.window.document;

      seasonDoc.querySelectorAll("article").forEach((ep, index) => {
        const link = ep.querySelector("a");
        const titleEl = ep.querySelector("h2");
        const imgEl = ep.querySelector("img");
        
        if (link && titleEl) {
          const episodeNum = index + 1;
          const seasonNumMatch = seasonName.match(/\d+/);
          const seasonNum = seasonNumMatch ? parseInt(seasonNumMatch[0]) : 1;
          
          episodes.push({
            url: link.href,
            name: titleEl.textContent.trim(),
            season: seasonNum,
            episode: episodeNum,
            poster: imgEl ? 
              (imgEl.src.startsWith("http") ? imgEl.src : `https:${imgEl.src}`) : 
              null
          });
        }
      });

    } catch (error) {
      console.error(`[Toonstream] Error loading season ${seasonId}:`, error.message);
    }
  }

  return episodes;
}

/* ---------------- STREAM EXTRACTION ---------------- */

async function extractStreams(pageUrl) {
  const response = await makeRequest(pageUrl);
  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const streams = [];
  const iframes = doc.querySelectorAll("#aa-options iframe");

  for (const frame of iframes) {
    const serverUrl = frame.getAttribute("data-src");
    if (!serverUrl) continue;

    try {
      // Follow iframe to get actual embed URL
      const iframeResponse = await makeRequest(serverUrl, {
        headers: { Referer: BASE_URL }
      });
      
      const iframeHtml = await iframeResponse.text();
      const iframeDom = new JSDOM(iframeHtml);
      const iframeDoc = iframeDom.window.document;
      
      const videoFrame = iframeDoc.querySelector("iframe");
      if (videoFrame && videoFrame.src) {
        streams.push({
          name: "Toonstream",
          title: "Toonstream Player",
          url: videoFrame.src,
          type: "iframe",
          headers: { 
            "User-Agent": HEADERS["User-Agent"],
            "Referer": serverUrl 
          }
        });
      }
    } catch (error) {
      console.error(`[Toonstream] Error extracting from ${serverUrl}:`, error.message);
    }
  }

  return streams;
}

/* ---------------- MAIN ENTRY ---------------- */

async function getStreams(tmdbId, mediaType = "movie", seasonNum = 1, episodeNum = 1) {
  console.log(`[Toonstream] Fetching for TMDB: ${tmdbId}, Type: ${mediaType}${mediaType === "tv" ? ` S${seasonNum}E${episodeNum}` : ""}`);
  
  try {
    const { title, year } = await getTmdbTitle(tmdbId, mediaType);
    console.log(`[Toonstream] TMDB: "${title}" ${year ? `(${year})` : ""}`);

    const searchResults = await searchToonstream(title, year);
    
    if (searchResults.length === 0) {
      console.log(`[Toonstream] No results found for "${title}"`);
      return [];
    }

    console.log(`[Toonstream] Found ${searchResults.length} results`);
    const selected = searchResults[0];
    console.log(`[Toonstream] Selected: ${selected.title} (similarity: ${selected.similarity.toFixed(2)})`);

    if (mediaType === "tv") {
      const episodes = await loadEpisodes(selected.url);
      console.log(`[Toonstream] Loaded ${episodes.length} episodes`);
      
      // Find matching episode
      const targetEpisode = episodes.find(ep => 
        ep.season === seasonNum && ep.episode === episodeNum
      ) || episodes[0]; // Fallback to first episode
      
      if (!targetEpisode) {
        console.log(`[Toonstream] No episode found for S${seasonNum}E${episodeNum}`);
        return [];
      }
      
      console.log(`[Toonstream] Using episode: ${targetEpisode.name} (S${targetEpisode.season}E${targetEpisode.episode})`);
      return await extractStreams(targetEpisode.url);
    }

    // For movies
    return await extractStreams(selected.url);

  } catch (error) {
    console.error(`[Toonstream] Error:`, error.message);
    return [];
  }
}

/* ---------------- EXPORT ---------------- */

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
