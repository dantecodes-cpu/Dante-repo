console.log("[Toonstream] Initializing Toonstream provider");

const BASE_URL = "https://toonstream.one";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// Add required Node.js modules
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0"
};

async function makeRequest(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...HEADERS, ...(options.headers || {}) },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${url}`);
    }
    
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout: ${url}`);
    }
    throw error;
  }
}

/* ---------------- TMDB ---------------- */

async function getTmdbTitle(tmdbId, mediaType) {
  try {
    const url = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await makeRequest(url);
    const data = await response.json();
    
    return {
      title: mediaType === "tv" ? data.name : data.title,
      year: mediaType === "tv" ? 
        (data.first_air_date || "").substring(0, 4) : 
        (data.release_date || "").substring(0, 4),
      originalTitle: data.original_title || data.original_name || ""
    };
  } catch (error) {
    console.error(`[Toonstream] TMDB error:`, error.message);
    return { title: "", year: null, originalTitle: "" };
  }
}

/* ---------------- SEARCH ---------------- */

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  const s2 = str2.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  
  if (s1 === s2) return 1;
  
  const words1 = s1.split(/\s+/).filter(w => w.length > 1);
  const words2 = s2.split(/\s+/).filter(w => w.length > 1);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  let matches = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1 === word2) {
        matches += 2;
      } else if (word1.includes(word2) || word2.includes(word1)) {
        matches += 1;
      }
    }
  }
  
  return matches / (words1.length + words2.length);
}

async function searchToonstream(query, year = null) {
  const results = [];
  const searchQueries = year ? 
    [`${query} ${year}`, query, `${query} cartoon`, `${query} anime`] : 
    [query, `${query} cartoon`, `${query} anime`];
  
  for (const searchQuery of searchQueries) {
    console.log(`[Toonstream] Searching: "${searchQuery}"`);
    
    for (let page = 1; page <= 2; page++) {
      try {
        const url = `${BASE_URL}/page/${page}/?s=${encodeURIComponent(searchQuery)}`;
        const response = await makeRequest(url);
        const html = await response.text();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        const items = doc.querySelectorAll("ul.items li article");
        
        if (items.length === 0 && page === 1) {
          break; // No results on first page
        }

        items.forEach(el => {
          try {
            const titleEl = el.querySelector("header.entry-header h2");
            const linkEl = el.querySelector("a");
            const imgEl = el.querySelector("img");
            
            if (titleEl && linkEl) {
              const rawTitle = titleEl.textContent || titleEl.innerText;
              const title = rawTitle
                .replace(/Watch\s+Online/gi, "")
                .replace(/Full\s+Movie/gi, "")
                .replace(/\s+/g, " ")
                .trim();
              
              const href = linkEl.href || linkEl.getAttribute("href");
              if (!href) return;
              
              let poster = null;
              if (imgEl) {
                const src = imgEl.src || imgEl.getAttribute("src") || imgEl.getAttribute("data-src");
                if (src) {
                  poster = src.startsWith("http") ? src : `https:${src}`;
                }
              }
              
              const similarity = calculateSimilarity(title, query);
              
              if (similarity >= 0.2) { // Lower threshold for cartoons/anime
                results.push({ 
                  title, 
                  url: href,
                  poster,
                  similarity 
                });
              }
            }
          } catch (itemError) {
            // Skip this item
          }
        });

        if (items.length < 8) break; // Last page

      } catch (error) {
        console.error(`[Toonstream] Search page ${page} error:`, error.message);
        break;
      }
    }
    
    if (results.length > 3) break; // Enough results found
  }
  
  // Remove duplicates and sort by similarity
  const uniqueResults = Array.from(new Map(results.map(item => [item.url, item])).values());
  return uniqueResults.sort((a, b) => b.similarity - a.similarity);
}

/* ---------------- LOAD EPISODES ---------------- */

async function loadEpisodes(seriesUrl) {
  try {
    const response = await makeRequest(seriesUrl);
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const episodes = [];
    
    // Check if it's actually a series page
    const hasSeasons = doc.querySelector("div.aa-drp.choose-season");
    if (!hasSeasons) {
      // This might be a movie page, treat as single "episode"
      episodes.push({
        url: seriesUrl,
        name: "Movie",
        season: 1,
        episode: 1,
        isMovie: true
      });
      return episodes;
    }

    const seasonSelect = doc.querySelector("select[name='season']");
    const seasons = [];
    
    if (seasonSelect) {
      // Get all season options
      seasonSelect.querySelectorAll("option").forEach(option => {
        if (option.value) {
          seasons.push({
            id: option.value,
            name: option.textContent.trim()
          });
        }
      });
    } else {
      // Try alternative method
      const seasonNodes = doc.querySelectorAll("div.aa-drp.choose-season ul li a");
      seasonNodes.forEach(node => {
        const seasonId = node.getAttribute("data-season");
        const seasonName = node.textContent.trim();
        if (seasonId) {
          seasons.push({
            id: seasonId,
            name: seasonName
          });
        }
      });
    }

    // Get post ID from the page
    const postIdMatch = html.match(/data-post="(\d+)"/);
    const postId = postIdMatch ? postIdMatch[1] : null;
    
    if (!postId) {
      console.log("[Toonstream] Could not find post ID");
      return episodes;
    }

    // Load episodes for each season
    for (const season of seasons) {
      try {
        const formData = new URLSearchParams({
          action: "action_select_season",
          season: season.id,
          post: postId,
        });

        const seasonResponse = await makeRequest(`${BASE_URL}/wp-admin/admin-ajax.php`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": seriesUrl
          },
          body: formData.toString(),
        });

        const seasonHtml = await seasonResponse.text();
        const seasonDom = new JSDOM(seasonHtml);
        const seasonDoc = seasonDom.window.document;

        const episodeArticles = seasonDoc.querySelectorAll("article");
        
        episodeArticles.forEach((ep, index) => {
          const link = ep.querySelector("a");
          const titleEl = ep.querySelector("h2");
          
          if (link && titleEl) {
            const href = link.href || link.getAttribute("href");
            const title = titleEl.textContent.trim();
            
            // Try to extract season and episode numbers from title
            let seasonNum = 1;
            let episodeNum = index + 1;
            
            // Common patterns: "S01E01", "Season 1 Episode 1", "Ep 1"
            const seasonMatch = title.match(/S(\d+)/i) || season.name.match(/Season\s*(\d+)/i);
            const episodeMatch = title.match(/E(\d+)/i) || title.match(/Episode\s*(\d+)/i);
            
            if (seasonMatch) seasonNum = parseInt(seasonMatch[1]);
            if (episodeMatch) episodeNum = parseInt(episodeMatch[1]);
            
            episodes.push({
              url: href,
              name: title,
              season: seasonNum,
              episode: episodeNum,
              seasonName: season.name
            });
          }
        });

      } catch (seasonError) {
        console.error(`[Toonstream] Error loading season ${season.name}:`, seasonError.message);
      }
    }

    return episodes;
  } catch (error) {
    console.error(`[Toonstream] Error loading episodes:`, error.message);
    return [];
  }
}

/* ---------------- STREAM EXTRACTION ---------------- */

async function extractStreams(pageUrl) {
  try {
    const response = await makeRequest(pageUrl, {
      headers: { Referer: BASE_URL }
    });
    
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const streams = [];
    
    // Look for iframes with video players
    const iframes = doc.querySelectorAll("#aa-options iframe, .player iframe, iframe[src*='stream']");
    
    for (const frame of iframes) {
      const serverUrl = frame.src || frame.getAttribute("src") || frame.getAttribute("data-src");
      if (!serverUrl) continue;

      try {
        // Clean the URL
        let cleanUrl = serverUrl.trim();
        if (cleanUrl.startsWith("//")) {
          cleanUrl = "https:" + cleanUrl;
        }
        
        // Check if it's a direct video URL
        if (cleanUrl.match(/\.(mp4|m3u8|mkv|avi|mov|wmv|flv|webm)$/i) || 
            cleanUrl.includes("m3u8") || 
            cleanUrl.includes("mp4")) {
          
          // Try to determine quality from URL
          let quality = "Unknown";
          if (cleanUrl.includes("1080")) quality = "1080p";
          else if (cleanUrl.includes("720")) quality = "720p";
          else if (cleanUrl.includes("480")) quality = "480p";
          else if (cleanUrl.includes("360")) quality = "360p";
          
          streams.push({
            name: "Toonstream Direct",
            title: `Toonstream (${quality})`,
            url: cleanUrl,
            type: cleanUrl.includes("m3u8") ? "hls" : "direct",
            quality: quality,
            headers: { 
              "User-Agent": HEADERS["User-Agent"],
              "Referer": pageUrl 
            }
          });
        } else {
          // It's another embed/page
          streams.push({
            name: "Toonstream Embed",
            title: "Toonstream Player",
            url: cleanUrl,
            type: "iframe",
            headers: { 
              "User-Agent": HEADERS["User-Agent"],
              "Referer": pageUrl 
            }
          });
        }
      } catch (error) {
        console.error(`[Toonstream] Error processing iframe:`, error.message);
      }
    }
    
    // Also look for direct video links in scripts
    const scripts = doc.querySelectorAll("script");
    for (const script of scripts) {
      const scriptContent = script.textContent || "";
      
      // Look for m3u8 URLs
      const m3u8Matches = scriptContent.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi);
      if (m3u8Matches) {
        for (const m3u8Url of m3u8Matches) {
          streams.push({
            name: "Toonstream HLS",
            title: "Toonstream HLS Stream",
            url: m3u8Url,
            type: "hls",
            quality: "HD",
            headers: { 
              "User-Agent": HEADERS["User-Agent"],
              "Referer": pageUrl 
            }
          });
        }
      }
      
      // Look for mp4 URLs
      const mp4Matches = scriptContent.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/gi);
      if (mp4Matches) {
        for (const mp4Url of mp4Matches) {
          streams.push({
            name: "Toonstream MP4",
            title: "Toonstream MP4 Stream",
            url: mp4Url,
            type: "direct",
            quality: "HD",
            headers: { 
              "User-Agent": HEADERS["User-Agent"],
              "Referer": pageUrl 
            }
          });
        }
      }
    }

    return streams;
  } catch (error) {
    console.error(`[Toonstream] Error extracting streams:`, error.message);
    return [];
  }
}

/* ---------------- MAIN ENTRY ---------------- */

async function getStreams(tmdbId, mediaType = "movie", seasonNum = 1, episodeNum = 1) {
  console.log(`[Toonstream] Fetching for TMDB: ${tmdbId}, Type: ${mediaType}${mediaType === "tv" ? ` S${seasonNum}E${episodeNum}` : ""}`);
  
  try {
    const { title, year, originalTitle } = await getTmdbTitle(tmdbId, mediaType);
    
    if (!title) {
      console.log(`[Toonstream] Could not get title from TMDB`);
      return [];
    }
    
    console.log(`[Toonstream] TMDB: "${title}" ${year ? `(${year})` : ""}`);

    // Try different search variations
    const searchQueries = [title];
    if (originalTitle && originalTitle !== title) {
      searchQueries.push(originalTitle);
    }
    if (year) {
      searchQueries.push(`${title} ${year}`);
    }
    
    let searchResults = [];
    for (const query of searchQueries) {
      searchResults = await searchToonstream(query, year);
      if (searchResults.length > 0) break;
    }
    
    if (searchResults.length === 0) {
      console.log(`[Toonstream] No results found`);
      return [];
    }

    console.log(`[Toonstream] Found ${searchResults.length} results`);
    
    // Select the best match
    const selected = searchResults[0];
    console.log(`[Toonstream] Selected: "${selected.title}" (similarity: ${selected.similarity.toFixed(2)})`);

    if (mediaType === "tv") {
      const episodes = await loadEpisodes(selected.url);
      console.log(`[Toonstream] Loaded ${episodes.length} episodes`);
      
      if (episodes.length === 0) {
        console.log(`[Toonstream] No episodes found`);
        return [];
      }
      
      // Find matching episode
      let targetEpisode = episodes.find(ep => 
        ep.season === seasonNum && ep.episode === episodeNum
      );
      
      // If not found, try to find by approximate match
      if (!targetEpisode) {
        targetEpisode = episodes.find(ep => 
          ep.season === seasonNum && Math.abs(ep.episode - episodeNum) <= 2
        );
      }
      
      // Fallback to first episode
      if (!targetEpisode) {
        targetEpisode = episodes[0];
        console.log(`[Toonstream] Using first episode as fallback`);
      }
      
      console.log(`[Toonstream] Using: "${targetEpisode.name}" (S${targetEpisode.season}E${targetEpisode.episode})`);
      const streams = await extractStreams(targetEpisode.url);
      console.log(`[Toonstream] Extracted ${streams.length} streams`);
      return streams;
    }

    // For movies
    console.log(`[Toonstream] Extracting streams from movie page`);
    const streams = await extractStreams(selected.url);
    console.log(`[Toonstream] Extracted ${streams.length} streams`);
    return streams;

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
