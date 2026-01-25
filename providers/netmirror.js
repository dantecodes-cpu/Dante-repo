var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

console.log("[NetMirror] Initializing NetMirror provider (Optimized)");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = "https://net51.cc/";

// 🚀 UPGRADE: Use Android User-Agent globally.
// This ensures we get mobile-optimized HLS streams (often better quality/compatibility).
const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive"
};

let globalCookie = "";
let cookieTimestamp = 0;
const COOKIE_EXPIRY = 54e6;

function makeRequest(url, options = {}) {
  return fetch(url, __spreadProps(__spreadValues({}, options), {
    headers: __spreadValues(__spreadValues({}, BASE_HEADERS), options.headers),
    timeout: 10000 // 10s timeout
  })).then(function(response) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  });
}

function getUnixTime() {
  return Math.floor(Date.now() / 1e3);
}

// Helper for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function bypass() {
  const now = Date.now();
  if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
    // console.log("[NetMirror] Using cached authentication cookie");
    return Promise.resolve(globalCookie);
  }
  console.log("[NetMirror] Bypassing authentication...");
  
  function attemptBypass(attempts) {
    if (attempts >= 4) { // Reduced attempts to 4 to fail faster if broken
      throw new Error("Max bypass attempts reached");
    }
    
    return makeRequest(`${NETMIRROR_BASE}tv/p.php`, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
        "Referer": `${NETMIRROR_BASE}tv/home`
      })
    }).then(function(response) {
      const setCookieHeader = response.headers.get("set-cookie");
      let extractedCookie = null;
      if (setCookieHeader) {
        // Handle array or string headers
        const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader;
        const cookieMatch = cookieString.match(/t_hash_t=([^;]+)/);
        if (cookieMatch) {
          extractedCookie = cookieMatch[1];
        }
      }
      return response.text().then(function(responseText) {
        if (!responseText.includes('"r":"n"')) {
          console.log(`[NetMirror] Bypass attempt ${attempts + 1} failed. Retrying...`);
          // Add small delay between retries
          return delay(1000).then(() => attemptBypass(attempts + 1));
        }
        if (extractedCookie) {
          globalCookie = extractedCookie;
          cookieTimestamp = Date.now();
          console.log("[NetMirror] Authentication successful");
          return globalCookie;
        }
        throw new Error("Failed to extract authentication cookie");
      });
    });
  }
  return attemptBypass(0);
}

function searchContent(query, platform) {
  console.log(`[NetMirror] Searching for "${query}" on ${platform}...`);
  const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "ott": ott,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const searchEndpoints = {
      "netflix": `${NETMIRROR_BASE}search.php`,
      "primevideo": `${NETMIRROR_BASE}pv/search.php`,
      "disney": `${NETMIRROR_BASE}mobile/hs/search.php`
    };
    const searchUrl = searchEndpoints[platform.toLowerCase()] || searchEndpoints["netflix"];
    
    return makeRequest(
      `${searchUrl}?s=${encodeURIComponent(query)}&t=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(r => r.json()).then(function(searchData) {
    if (searchData.searchResult && searchData.searchResult.length > 0) {
      console.log(`[NetMirror] Found ${searchData.searchResult.length} results`);
      return searchData.searchResult.map((item) => ({
        id: item.id,
        title: item.t,
        posterUrl: `https://imgcdn.media/poster/v/${item.id}.jpg`
      }));
    } else {
      console.log("[NetMirror] No results found");
      return [];
    }
  });
}

function getEpisodesFromSeason(seriesId, seasonId, platform, page) {
  const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "ott": ott,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    const episodes = [];
    let currentPage = page || 1;
    
    const episodesEndpoints = {
      "netflix": `${NETMIRROR_BASE}episodes.php`,
      "primevideo": `${NETMIRROR_BASE}pv/episodes.php`,
      "disney": `${NETMIRROR_BASE}mobile/hs/episodes.php`
    };
    const episodesUrl = episodesEndpoints[platform.toLowerCase()] || episodesEndpoints["netflix"];
    
    function fetchPage(pageNum) {
      return makeRequest(
        `${episodesUrl}?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${pageNum}`,
        {
          headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
            "Cookie": cookieString,
            "Referer": `${NETMIRROR_BASE}tv/home`
          })
        }
      ).then(r => r.json()).then(function(episodeData) {
        if (episodeData.episodes) {
          episodes.push(...episodeData.episodes);
        }
        if (episodeData.nextPageShow === 0) {
          return episodes;
        } else {
          return fetchPage(pageNum + 1);
        }
      }).catch(function(error) {
        console.log(`[NetMirror] Failed to load episodes from season ${seasonId}, page ${pageNum}`);
        return episodes;
      });
    }
    return fetchPage(currentPage);
  });
}

function loadContent(contentId, platform) {
  // console.log(`[NetMirror] Loading content details for ID: ${contentId}`);
  const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "ott": ott,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const postEndpoints = {
      "netflix": `${NETMIRROR_BASE}post.php`,
      "primevideo": `${NETMIRROR_BASE}pv/post.php`,
      "disney": `${NETMIRROR_BASE}mobile/hs/post.php`
    };
    const postUrl = postEndpoints[platform.toLowerCase()] || postEndpoints["netflix"];
    
    return makeRequest(
      `${postUrl}?id=${contentId}&t=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(r => r.json()).then(function(postData) {
    let allEpisodes = postData.episodes || [];
    
    if (postData.episodes && postData.episodes.length > 0 && postData.episodes[0] !== null) {
      // console.log("[NetMirror] Loading episodes from all seasons...");
      let episodePromise = Promise.resolve();
      
      if (postData.nextPageShow === 1 && postData.nextPageSeason) {
        episodePromise = episodePromise.then(function() {
          return getEpisodesFromSeason(contentId, postData.nextPageSeason, platform, 2);
        }).then((additionalEpisodes) => { allEpisodes.push(...additionalEpisodes); });
      }
      
      if (postData.season && postData.season.length > 1) {
        const otherSeasons = postData.season.slice(0, -1);
        otherSeasons.forEach(function(season) {
          episodePromise = episodePromise.then(function() {
            return getEpisodesFromSeason(contentId, season.id, platform, 1);
          }).then((seasonEpisodes) => { allEpisodes.push(...seasonEpisodes); });
        });
      }
      
      return episodePromise.then(function() {
        return {
          id: contentId,
          title: postData.title,
          description: postData.desc,
          year: postData.year,
          episodes: allEpisodes,
          seasons: postData.season || [],
          isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
        };
      });
    }
    
    return {
      id: contentId,
      title: postData.title,
      description: postData.desc,
      year: postData.year,
      episodes: allEpisodes,
      seasons: postData.season || [],
      isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
    };
  });
}

// 🔧 IMPROVED URL & QUALITY PARSER
function getStreamingLinks(contentId, title, platform) {
  console.log(`[NetMirror] Getting streaming links for: ${title} (${platform})`);
  const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "hd": "on",
      "ott": ott
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    let playlistUrl;
    
    if (platform.toLowerCase() === "primevideo") playlistUrl = `${NETMIRROR_BASE}tv/pv/playlist.php`;
    else if (platform.toLowerCase() === "disney") playlistUrl = `${NETMIRROR_BASE}mobile/hs/playlist.php`;
    else playlistUrl = `${NETMIRROR_BASE}tv/playlist.php`;

    return makeRequest(
      `${playlistUrl}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(r => r.json()).then(function(playlist) {
    if (!Array.isArray(playlist) || playlist.length === 0) {
      console.log("[NetMirror] No streaming links found");
      return { sources: [], subtitles: [] };
    }
    
    const sources = [];
    const subtitles = [];
    
    playlist.forEach((item) => {
      // Process Video Sources
      if (item.sources) {
        item.sources.forEach((source) => {
          let fullUrl = source.file;
          
          // 1. ROBUST URL CLEANING
          // Fix Netflix path oddity
          if (platform.toLowerCase() === "netflix" && fullUrl.includes("/tv/")) {
             fullUrl = fullUrl.replace("://net51.cc/tv/", "://net51.cc/").replace(/^\/tv\//, "/");
          }
          
          // Use URL constructor for safety (Handles // and relative paths correctly)
          try {
              if (fullUrl.startsWith('//')) fullUrl = 'https:' + fullUrl;
              else if (!fullUrl.startsWith('http')) fullUrl = new URL(fullUrl, NETMIRROR_BASE).href;
          } catch(e) {
              // fallback if URL construction fails
              if (!fullUrl.startsWith('http')) fullUrl = NETMIRROR_BASE + fullUrl.replace(/^\//, '');
          }

          // 2. ENHANCED QUALITY DETECTION (Fixes Disney+ 1080p issue)
          let quality = "HD";
          let label = (source.label || "").toLowerCase();
          
          // A. If it's a master playlist (auto), treat as 1080p capable
          if (label === "auto" || label === "master") {
              quality = "1080p (Auto)";
          } 
          // B. Detect explicit 1080p tags
          else if (label.includes("1080") || label.includes("full") || label.includes("fhd") || label.includes("original")) {
              quality = "1080p";
          }
          // C. Detect 720p
          else if (label.includes("720") || label.includes("hd")) {
              quality = "720p";
          }
          // D. Detect 480p/SD
          else if (label.includes("480") || label.includes("sd")) {
              quality = "480p";
          }
          
          sources.push({
            url: fullUrl,
            quality: quality,
            type: source.type || "application/x-mpegURL"
          });
        });
      }
      
      // Process Subtitles
      if (item.tracks) {
        item.tracks.filter((track) => track.kind === "captions").forEach((track) => {
          let fullSubUrl = track.file;
          try {
             if (fullSubUrl.startsWith('//')) fullSubUrl = 'https:' + fullSubUrl;
             else if (!fullSubUrl.startsWith('http')) fullSubUrl = new URL(fullSubUrl, NETMIRROR_BASE).href;
          } catch(e) {}
          
          subtitles.push({
            url: fullSubUrl,
            language: track.label || "English"
          });
        });
      }
    });
    
    console.log(`[NetMirror] Found ${sources.length} sources.`);
    return { sources, subtitles };
  });
}

function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  return makeRequest(tmdbUrl).then(r => r.json()).then(function(tmdbData) {
    var _a, _b;
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? (_a = tmdbData.first_air_date) == null ? void 0 : _a.substring(0, 4) : (_b = tmdbData.release_date) == null ? void 0 : _b.substring(0, 4);
    if (!title) throw new Error("Could not extract title from TMDB response");
    
    console.log(`[NetMirror] TMDB Info: "${title}" (${year})`);
    
    let platforms = ["netflix", "primevideo", "disney"];
    // Prioritize platforms based on keywords
    if (title.toLowerCase().includes("boys") || title.toLowerCase().includes("prime")) {
      platforms = ["primevideo", "netflix", "disney"];
    } else if (title.toLowerCase().includes("mandalorian") || title.toLowerCase().includes("marvel")) {
        platforms = ["disney", "netflix", "primevideo"];
    }
    
    function calculateSimilarity(str1, str2) {
      const s1 = str1.toLowerCase().trim();
      const s2 = str2.toLowerCase().trim();
      if (s1 === s2) return 1;
      const words1 = s1.split(/[\s\-.,:;()]+/).filter((w) => w.length > 0);
      const words2 = s2.split(/[\s\-.,:;()]+/).filter((w) => w.length > 0);
      let exactMatches = 0;
      for (const queryWord of words2) {
        if (words1.includes(queryWord)) exactMatches++;
      }
      return exactMatches / Math.max(words1.length, words2.length);
    }
    
    function filterRelevantResults(searchResults, query, mediaType) {
      const filtered = searchResults.filter((result) => {
        const similarity = calculateSimilarity(result.title, query);
        if (similarity < 0.4) return false;
        
        const lowerTitle = result.title.toLowerCase();
        if (mediaType === "tv") {
          const hasSeason = lowerTitle.includes("season") || lowerTitle.match(/s\d+/i);
          const hasEpisode = lowerTitle.includes("episode") || lowerTitle.match(/e\d+/i);
          if (hasSeason || hasEpisode || lowerTitle.includes("series")) return true;
          if (lowerTitle.includes("movie") || lowerTitle.includes("film")) return false;
          
          if (query.toLowerCase().includes("boys")) {
             if (lowerTitle.includes("hindi") || lowerTitle.includes("indian")) return false;
          }
        }
        return true;
      });
      return filtered.sort((a, b) => calculateSimilarity(b.title, query) - calculateSimilarity(a.title, query));
    }
    
    function tryPlatform(platformIndex) {
      if (platformIndex >= platforms.length) {
        console.log("[NetMirror] No content found on any platform");
        return [];
      }
      const platform = platforms[platformIndex];
      // console.log(`[NetMirror] Trying platform: ${platform}`);
      
      function trySearch(withYear) {
        const searchQuery = withYear ? `${title} ${year}` : title;
        return searchContent(searchQuery, platform).then(function(searchResults) {
          if (searchResults.length === 0) {
            if (!withYear && year) return trySearch(true);
            return null;
          }
          
          const relevantResults = filterRelevantResults(searchResults, title, mediaType);
          if (relevantResults.length === 0) {
            if (!withYear && year) return trySearch(true);
            return null;
          }
          
          const selectedContent = relevantResults[0];
          console.log(`[NetMirror] Selected: ${selectedContent.title} (ID: ${selectedContent.id})`);
          
          return loadContent(selectedContent.id, platform).then(function(contentData) {
            if (mediaType === "tv" && contentData.isMovie) {
               // Try second result if first one mismatch
               if (relevantResults.length > 1) {
                  return loadContent(relevantResults[1].id, platform).then(next => {
                      if(next.isMovie) return null;
                      return processContent(next, relevantResults[1].id);
                  });
               }
               return null;
            }
            return processContent(contentData, selectedContent.id);
            
            function processContent(contentData, contentId) {
              let targetContentId = contentId;
              let episodeData = null;
              
              if (mediaType === "tv" && !contentData.isMovie) {
                const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
                episodeData = validEpisodes.find((ep) => {
                  let epSeason, epNumber;
                  // Handle various episode formats from API
                  if (ep.s && ep.ep) {
                    epSeason = parseInt(ep.s.replace("S", ""));
                    epNumber = parseInt(ep.ep.replace("E", ""));
                  } else if (ep.season && ep.episode) {
                    epSeason = parseInt(ep.season);
                    epNumber = parseInt(ep.episode);
                  } else if (ep.season_number && ep.episode_number) {
                    epSeason = parseInt(ep.season_number);
                    epNumber = parseInt(ep.episode_number);
                  }
                  return epSeason === (seasonNum || 1) && epNumber === (episodeNum || 1);
                });
                
                if (episodeData) {
                  targetContentId = episodeData.id;
                } else {
                  console.log(`[NetMirror] Episode S${seasonNum}E${episodeNum} not found`);
                  return null;
                }
              }
              
              return getStreamingLinks(targetContentId, title, platform).then(function(streamData) {
                if (!streamData.sources || streamData.sources.length === 0) return null;
                
                const streams = streamData.sources.map((source) => {
                  // Final Quality Check
                  let streamTitle = `${title} ${source.quality}`;
                  if (mediaType === "tv") {
                    streamTitle += ` S${seasonNum}E${episodeNum}`;
                  }
                  
                  return {
                    name: `NetMirror (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                    title: streamTitle,
                    url: source.url,
                    quality: source.quality,
                    type: "hls", // NetMirror sources are almost always HLS
                    headers: {
                      "User-Agent": BASE_HEADERS["User-Agent"],
                      "Accept": "*/*",
                      "Referer": "https://net51.cc/"
                    }
                  };
                });
                
                // Sort Priority: 1080p (Auto) > 1080p > 720p > 480p
                streams.sort((a, b) => {
                   const score = (q) => {
                       if (q.includes("Auto") || q.includes("Master")) return 10000;
                       if (q.includes("1080")) return 1080;
                       if (q.includes("720")) return 720;
                       if (q.includes("480")) return 480;
                       return 0;
                   };
                   return score(b.quality) - score(a.quality);
                });
                
                return streams;
              });
            }
          });
        });
      }
      
      return trySearch(false).then(function(result) {
        if (result) return result;
        return tryPlatform(platformIndex + 1);
      }).catch(e => tryPlatform(platformIndex + 1));
    }
    
    return tryPlatform(0);
  }).catch(function(error) {
    console.error(`[NetMirror] Error: ${error.message}`);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
