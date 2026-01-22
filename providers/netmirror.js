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
console.log("[NetMirror] Initializing NetMirror provider");
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = "https://net51.cc/";
const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
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
    timeout: 1e4
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

function bypass() {
  const now = Date.now();
  if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
    console.log("[NetMirror] Using cached authentication cookie");
    return Promise.resolve(globalCookie);
  }
  
  console.log("[NetMirror] Bypassing authentication...");
  function attemptBypass(attempts) {
    if (attempts >= 5) {
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
      if (setCookieHeader && (typeof setCookieHeader === "string" || Array.isArray(setCookieHeader))) {
        const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader;
        const cookieMatch = cookieString.match(/t_hash_t=([^;]+)/);
        if (cookieMatch) {
          extractedCookie = cookieMatch[1];
        }
      }
      return response.text().then(function(responseText) {
        if (!responseText.includes('"r":"n"')) {
          console.log(`[NetMirror] Bypass attempt ${attempts + 1} failed, retrying...`);
          return attemptBypass(attempts + 1);
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
  const ottMap = {
    "netflix": "nf",
    "primevideo": "pv",
    "disney": "hs"
  };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "233123f803cf02184bf6c67e149cdd50",
      "hd": "on",
      "ott": ott
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    // Based on Kotlin repo, all platforms use their own search endpoints
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
  }).then(function(response) {
    return response.json();
  }).then(function(searchData) {
    // Based on Kotlin code, results are in searchData.searchResult
    const results = searchData.searchResult || searchData.results || [];
    
    if (results.length > 0) {
      console.log(`[NetMirror] Found ${results.length} results on ${platform}`);
      return results.map((item) => ({
        id: item.id,
        title: item.t || item.title,
        posterUrl: item.poster || `https://imgcdn.media/poster/v/${item.id}.jpg`
      }));
    } else {
      console.log(`[NetMirror] No results found on ${platform}`);
      return [];
    }
  });
}

function loadContent(contentId, platform) {
  console.log(`[NetMirror] Loading content details for ID: ${contentId} on ${platform}`);
  
  return bypass().then(function(cookie) {
    const ottMap = {
      "netflix": "nf",
      "primevideo": "pv", 
      "disney": "hs"
    };
    const ott = ottMap[platform.toLowerCase()] || "nf";
    
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "233123f803cf02184bf6c67e149cdd50",
      "ott": ott,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    // Based on Kotlin repo, endpoints are different
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
  }).then(function(response) {
    return response.json();
  }).then(function(postData) {
    console.log(`[NetMirror] Loaded: ${postData.title || postData.name} on ${platform}`);
    
    return {
      id: contentId,
      title: postData.title || postData.name,
      description: postData.desc || postData.description,
      year: postData.year || postData.release_year,
      episodes: postData.episodes || [],
      seasons: postData.season || [],
      isMovie: !postData.episodes || postData.episodes.length === 0
    };
  });
}

function getStreamingLinks(contentId, title, platform) {
  console.log(`[NetMirror] Getting streaming links for: ${title} on ${platform}`);
  
  return bypass().then(function(cookie) {
    const ottMap = {
      "netflix": "nf",
      "primevideo": "pv",
      "disney": "hs"
    };
    const ott = ottMap[platform.toLowerCase()] || "nf";
    
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "233123f803cf02184bf6c67e149cdd50",
      "ott": ott,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    // Based on Kotlin, all platforms use the same playlist endpoint
    const playlistUrl = `${NETMIRROR_BASE}tv/playlist.php`;
    
    return makeRequest(
      `${playlistUrl}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(function(response) {
    return response.json();
  }).then(function(playlistData) {
    if (!playlistData || (Array.isArray(playlistData) && playlistData.length === 0)) {
      console.log(`[NetMirror] No playlist data found for ${title} on ${platform}`);
      return { sources: [], subtitles: [] };
    }
    
    const sources = [];
    const subtitles = [];
    
    const playlistItems = Array.isArray(playlistData) ? playlistData : [playlistData];
    
    playlistItems.forEach((item) => {
      // Extract streaming sources - based on Kotlin implementation
      if (item.sources && Array.isArray(item.sources)) {
        item.sources.forEach((source) => {
          if (source.file) {
            let fullUrl = source.file;
            
            // Clean the URL - remove any tv/ prefix that shouldn't be there
            // Based on your examples:
            // Netflix: https://net51.cc/hls/81915745.m3u8 (NOT tv/hls/)
            // Disney: https://net51.cc//mobile/hs/hls/1260016934.m3u8
            // Prime: https://net51.cc/pv/hls/0G2G9F9BZAJUW8XZ2RQ5N3MRBS.m3u8
            
            // Fix double slashes
            fullUrl = fullUrl.replace(/\/\//g, '/');
            
            if (!fullUrl.startsWith('http')) {
              // Remove leading slash
              if (fullUrl.startsWith('/')) {
                fullUrl = fullUrl.substring(1);
              }
              
              // Check what we have and format it correctly
              if (platform.toLowerCase() === 'disney') {
                // Disney should be: mobile/hs/hls/{id}.m3u8
                if (!fullUrl.includes('mobile/hs/hls/')) {
                  // Extract the m3u8 filename
                  const m3u8Match = fullUrl.match(/(\d+\.m3u8.*)/);
                  if (m3u8Match) {
                    fullUrl = `mobile/hs/hls/${m3u8Match[1]}`;
                  } else if (fullUrl.includes('hls/')) {
                    // Already has hls/, just need to add mobile/hs/
                    const parts = fullUrl.split('hls/');
                    if (parts.length > 1) {
                      fullUrl = `mobile/hs/hls/${parts[1]}`;
                    }
                  }
                }
              } else if (platform.toLowerCase() === 'primevideo') {
                // Prime should be: pv/hls/{id}.m3u8
                if (!fullUrl.includes('pv/hls/')) {
                  // Extract the m3u8 filename (Prime uses alphanumeric IDs)
                  const m3u8Match = fullUrl.match(/([A-Z0-9]+\.m3u8.*)/);
                  if (m3u8Match) {
                    fullUrl = `pv/hls/${m3u8Match[1]}`;
                  } else if (fullUrl.includes('hls/')) {
                    // Already has hls/, just need to add pv/
                    const parts = fullUrl.split('hls/');
                    if (parts.length > 1) {
                      fullUrl = `pv/hls/${parts[1]}`;
                    }
                  }
                }
              } else {
                // Netflix should be: hls/{id}.m3u8 (NOT tv/hls/)
                if (fullUrl.includes('tv/hls/')) {
                  // Remove the tv/ prefix
                  fullUrl = fullUrl.replace('tv/hls/', 'hls/');
                } else if (!fullUrl.includes('hls/')) {
                  // Extract the m3u8 filename
                  const m3u8Match = fullUrl.match(/(\d+\.m3u8.*)/);
                  if (m3u8Match) {
                    fullUrl = `hls/${m3u8Match[1]}`;
                  }
                }
              }
              
              // Add base URL
              fullUrl = NETMIRROR_BASE + fullUrl;
            }
            
            // Clean up any remaining double slashes
            fullUrl = fullUrl.replace(/([^:])\/\//g, '$1/');
            
            // Add quality information
            let quality = "HD";
            if (source.label) {
              const qualityMatch = source.label.match(/(\d{3,4})p/i);
              if (qualityMatch) {
                quality = qualityMatch[1] + "p";
              } else if (source.label.toLowerCase().includes('1080') || source.label.toLowerCase().includes('full hd')) {
                quality = "1080p";
              } else if (source.label.toLowerCase().includes('720') || source.label.toLowerCase().includes('hd')) {
                quality = "720p";
              } else if (source.label.toLowerCase().includes('480')) {
                quality = "480p";
              }
            }
            
            sources.push({
              url: fullUrl,
              quality: quality,
              type: source.type || "application/x-mpegURL",
              label: source.label || quality
            });
          }
        });
      }
      
      // Extract subtitles
      if (item.tracks && Array.isArray(item.tracks)) {
        item.tracks.forEach((track) => {
          if (track.kind === "captions" || track.kind === "subtitles") {
            let subUrl = track.file || track.url;
            if (subUrl) {
              if (subUrl.startsWith('/')) {
                subUrl = NETMIRROR_BASE + subUrl.substring(1);
              } else if (subUrl.startsWith('//')) {
                subUrl = 'https:' + subUrl;
              } else if (!subUrl.startsWith('http')) {
                subUrl = NETMIRROR_BASE + subUrl;
              }
              
              subtitles.push({
                url: subUrl,
                language: track.label || track.language || "English",
                kind: track.kind
              });
            }
          }
        });
      }
    });
    
    console.log(`[NetMirror] Found ${sources.length} streaming sources and ${subtitles.length} subtitle tracks on ${platform}`);
    
    // Log the URLs for debugging
    if (sources.length > 0) {
      console.log(`[NetMirror] Generated URLs:`);
      sources.forEach((source, i) => {
        console.log(`  ${i + 1}. ${source.url}`);
      });
    }
    
    return { sources, subtitles };
  });
}

function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ""}`);
  
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  return makeRequest(tmdbUrl)
    .then(tmdbResponse => tmdbResponse.json())
    .then(tmdbData => {
      const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
      const year = mediaType === "tv" ? 
        (tmdbData.first_air_date || "").substring(0, 4) : 
        (tmdbData.release_date || "").substring(0, 4);
      
      if (!title) {
        throw new Error("Could not extract title from TMDB response");
      }
      
      console.log(`[NetMirror] TMDB Info: "${title}" (${year})`);
      
      // Based on Kotlin, try platforms in order but handle failures better
      const platforms = ["netflix", "primevideo", "disney"];
      
      function tryPlatform(platformIndex) {
        if (platformIndex >= platforms.length) {
          console.log("[NetMirror] No content found on any platform");
          return [];
        }
        
        const platform = platforms[platformIndex];
        console.log(`[NetMirror] Searching on ${platform}...`);
        
        // Try searching with the title
        return searchContent(title, platform)
          .then(searchResults => {
            // If no results with just title, try with year
            if (searchResults.length === 0 && year) {
              console.log(`[NetMirror] Trying with year: "${title} ${year}"`);
              return searchContent(`${title} ${year}`, platform);
            }
            return searchResults;
          })
          .then(searchResults => {
            if (searchResults.length === 0) {
              console.log(`[NetMirror] No search results on ${platform}`);
              // Continue to next platform
              return tryPlatform(platformIndex + 1);
            }
            
            console.log(`[NetMirror] Found ${searchResults.length} results on ${platform}`);
            
            // For PrimeVideo, we might need to handle special cases
            if (platform === "primevideo") {
              // Try to find the most relevant result
              const relevantResult = searchResults.find(item => 
                item.title.toLowerCase().includes(title.toLowerCase()) ||
                title.toLowerCase().includes(item.title.toLowerCase())
              ) || searchResults[0];
              
              return loadAndGetStreams(relevantResult, platform);
            } else {
              // For Netflix and Disney, use first result
              return loadAndGetStreams(searchResults[0], platform);
            }
          })
          .catch(error => {
            console.log(`[NetMirror] Error on ${platform}: ${error.message}`);
            return tryPlatform(platformIndex + 1);
          });
      }
      
      function loadAndGetStreams(content, platform) {
        console.log(`[NetMirror] Loading content: ${content.title} (${content.id}) on ${platform}`);
        
        return loadContent(content.id, platform)
          .then(contentData => {
            let streamContentId = content.id;
            
            // For TV shows with specific episode request
            if (mediaType === "tv" && seasonNum && episodeNum && !contentData.isMovie) {
              console.log(`[NetMirror] Looking for episode S${seasonNum}E${episodeNum}`);
              
              if (contentData.episodes && contentData.episodes.length > 0) {
                const episode = contentData.episodes.find(ep => {
                  if (!ep) return false;
                  
                  // Try to parse episode info
                  let epSeason, epNumber;
                  
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
                  
                  return epSeason === seasonNum && epNumber === episodeNum;
                });
                
                if (episode && episode.id) {
                  streamContentId = episode.id;
                  console.log(`[NetMirror] Found episode ID: ${streamContentId}`);
                }
              }
            }
            
            return getStreamingLinks(streamContentId, contentData.title, platform);
          })
          .then(streamData => {
            if (!streamData.sources || streamData.sources.length === 0) {
              console.log(`[NetMirror] No streaming links on ${platform}`);
              throw new Error("No streaming links");
            }
            
            // Format the streams
            const streams = streamData.sources.map((source) => {
              let streamTitle = `${title}`;
              if (year) streamTitle += ` (${year})`;
              streamTitle += ` - ${source.quality}`;
              if (mediaType === "tv" && seasonNum && episodeNum) {
                streamTitle += ` S${seasonNum}E${episodeNum}`;
              }
              
              // Set appropriate headers based on platform
              const headers = {
                "Referer": `${NETMIRROR_BASE}tv/home`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9"
              };
              
              return {
                name: `NetMirror (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                title: streamTitle,
                url: source.url,
                quality: source.quality,
                type: source.type.includes("mpegURL") ? "hls" : "direct",
                headers: headers
              };
            });
            
            // Sort by quality
            streams.sort((a, b) => {
              const getQualityNum = (q) => {
                const match = q.match(/(\d{3,4})p/i);
                return match ? parseInt(match[1]) : 0;
              };
              return getQualityNum(b.quality) - getQualityNum(a.quality);
            });
            
            console.log(`[NetMirror] Successfully got ${streams.length} streams from ${platform}`);
            return streams;
          })
          .catch(error => {
            console.log(`[NetMirror] Failed to get streams from ${platform}: ${error.message}`);
            throw error; // Propagate to try next platform
          });
      }
      
      return tryPlatform(0);
    })
    .catch(error => {
      console.error(`[NetMirror] Error in getStreams: ${error.message}`);
      return [];
    });
}

// Export for testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, searchContent, loadContent, getStreamingLinks };
} else {
  global.getStreams = getStreams;
  global.searchContent = searchContent;
  global.loadContent = loadContent;
  global.getStreamingLinks = getStreamingLinks;
}
