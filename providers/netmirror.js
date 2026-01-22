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
    return makeRequest(`${NETMIRROR_BASE}/tv/p.php`, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
        "Referer": `${NETMIRROR_BASE}/tv/home`
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
    
    // Updated endpoints based on Kotlin repo
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
    // Handle different response formats for different platforms
    let results = [];
    if (platform.toLowerCase() === "primevideo") {
      results = searchData.results || searchData.searchResult || [];
    } else if (platform.toLowerCase() === "disney") {
      results = searchData.results || searchData.searchResult || [];
    } else {
      results = searchData.searchResult || [];
    }
    
    if (results.length > 0) {
      console.log(`[NetMirror] Found ${results.length} results`);
      return results.map((item) => ({
        id: item.id,
        title: item.t || item.title,
        posterUrl: item.poster || `https://imgcdn.media/poster/v/${item.id}.jpg`
      }));
    } else {
      console.log("[NetMirror] No results found");
      return [];
    }
  });
}

function getEpisodesFromSeason(seriesId, seasonId, platform, page) {
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
      "ott": ott,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const episodes = [];
    let currentPage = page || 1;
    
    // Updated endpoints
    const episodesEndpoints = {
      "netflix": `${NETMIRROR_BASE}episodes.php`,
      "primevideo": `${NETMIRROR_BASE}pv/episodes.php`,
      "disney": `${NETMIRROR_BASE}mobile/hs/episodes.php`
    };
    
    const episodesUrl = episodesEndpoints[platform.toLowerCase()] || episodesEndpoints["netflix"];
    
    function fetchPage(pageNum) {
      const params = new URLSearchParams({
        s: seasonId,
        series: seriesId,
        t: getUnixTime(),
        page: pageNum
      });
      
      return makeRequest(
        `${episodesUrl}?${params}`,
        {
          headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
            "Cookie": cookieString,
            "Referer": `${NETMIRROR_BASE}tv/home`
          })
        }
      ).then(function(response) {
        return response.json();
      }).then(function(episodeData) {
        if (episodeData.episodes) {
          episodes.push(...episodeData.episodes);
        }
        // Check if there are more pages
        if (episodeData.nextPageShow === 0 || episodeData.nextPageShow === false) {
          return episodes;
        } else {
          return fetchPage(pageNum + 1);
        }
      }).catch(function(error) {
        console.log(`[NetMirror] Failed to load episodes from season ${seasonId}, page ${pageNum}: ${error.message}`);
        return episodes;
      });
    }
    
    return fetchPage(currentPage);
  });
}

function loadContent(contentId, platform) {
  console.log(`[NetMirror] Loading content details for ID: ${contentId}`);
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
      "ott": ott,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    // Updated endpoints based on Kotlin repo
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
    console.log(`[NetMirror] Loaded: ${postData.title || postData.name}`);
    
    let allEpisodes = postData.episodes || [];
    const seasons = postData.season || postData.seasons || [];
    
    // For TV shows, load additional episodes from other seasons if needed
    if (seasons.length > 1 && allEpisodes.length > 0) {
      console.log("[NetMirror] Loading episodes from all seasons...");
      
      let episodePromises = [];
      // Load episodes from other seasons
      for (const season of seasons) {
        if (season.id && season.id !== postData.currentSeason) {
          episodePromises.push(
            getEpisodesFromSeason(contentId, season.id, platform, 1)
              .then(seasonEpisodes => {
                allEpisodes.push(...seasonEpisodes);
              })
          );
        }
      }
      
      return Promise.all(episodePromises).then(() => {
        console.log(`[NetMirror] Loaded ${allEpisodes.filter(ep => ep !== null).length} total episodes`);
        return {
          id: contentId,
          title: postData.title || postData.name,
          description: postData.desc || postData.description,
          year: postData.year || postData.release_year,
          episodes: allEpisodes,
          seasons: seasons,
          isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
        };
      });
    }
    
    return {
      id: contentId,
      title: postData.title || postData.name,
      description: postData.desc || postData.description,
      year: postData.year || postData.release_year,
      episodes: allEpisodes,
      seasons: seasons,
      isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
    };
  });
}

function getStreamingLinks(contentId, title, platform) {
  console.log(`[NetMirror] Getting streaming links for: ${title}`);
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
      "ott": ott,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    // Updated playlist endpoint
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
  }).then(function(playlist) {
    // Handle different response formats
    if (!playlist || (Array.isArray(playlist) && playlist.length === 0)) {
      console.log("[NetMirror] No streaming links found");
      return { sources: [], subtitles: [] };
    }
    
    const sources = [];
    const subtitles = [];
    
    // If playlist is not an array, try to extract from object
    const playlistArray = Array.isArray(playlist) ? playlist : [playlist];
    
    playlistArray.forEach((item) => {
      if (item.sources && Array.isArray(item.sources)) {
        item.sources.forEach((source) => {
          let fullUrl = source.file || source.url;
          if (!fullUrl) return;
          
          // Handle URL formatting
          if (fullUrl.startsWith("/")) {
            fullUrl = NETMIRROR_BASE + fullUrl.substring(1);
          } else if (!fullUrl.startsWith("http")) {
            fullUrl = NETMIRROR_BASE + fullUrl;
          }
          
          sources.push({
            url: fullUrl,
            quality: source.label || "HD",
            type: source.type || "application/x-mpegURL"
          });
        });
      }
      
      if (item.tracks && Array.isArray(item.tracks)) {
        item.tracks.filter((track) => track.kind === "captions" || track.kind === "subtitles").forEach((track) => {
          let fullSubUrl = track.file || track.url;
          if (!fullSubUrl) return;
          
          if (fullSubUrl.startsWith("/") && !fullSubUrl.startsWith("//")) {
            fullSubUrl = NETMIRROR_BASE + fullSubUrl.substring(1);
          } else if (fullSubUrl.startsWith("//")) {
            fullSubUrl = "https:" + fullSubUrl;
          } else if (!fullSubUrl.startsWith("http")) {
            fullSubUrl = NETMIRROR_BASE + fullSubUrl;
          }
          
          subtitles.push({
            url: fullSubUrl,
            language: track.label || track.language || "en"
          });
        });
      }
    });
    
    console.log(`[NetMirror] Found ${sources.length} streaming sources and ${subtitles.length} subtitle tracks`);
    return { sources, subtitles };
  });
}

function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ""}`);
  
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  return makeRequest(tmdbUrl).then(function(tmdbResponse) {
    return tmdbResponse.json();
  }).then(function(tmdbData) {
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? 
      (tmdbData.first_air_date || "").substring(0, 4) : 
      (tmdbData.release_date || "").substring(0, 4);
    
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    
    console.log(`[NetMirror] TMDB Info: "${title}" (${year})`);
    
    // Try platforms in order
    const platforms = ["netflix", "primevideo", "disney"];
    
    function tryPlatform(platformIndex) {
      if (platformIndex >= platforms.length) {
        console.log("[NetMirror] No content found on any platform");
        return [];
      }
      
      const platform = platforms[platformIndex];
      console.log(`[NetMirror] Trying platform: ${platform}`);
      
      return searchContent(title, platform)
        .then(function(searchResults) {
          if (searchResults.length === 0) {
            // Try with year if available
            if (year) {
              return searchContent(`${title} ${year}`, platform);
            }
            return [];
          }
          return searchResults;
        })
        .then(function(searchResults) {
          if (searchResults.length === 0) {
            console.log(`[NetMirror] No results found on ${platform}`);
            return tryPlatform(platformIndex + 1);
          }
          
          // Find the best matching result
          const selectedResult = searchResults[0];
          console.log(`[NetMirror] Selected: ${selectedResult.title} (ID: ${selectedResult.id})`);
          
          return loadContent(selectedResult.id, platform)
            .then(function(contentData) {
              let targetContentId = selectedResult.id;
              
              // For TV shows, find specific episode if requested
              if (mediaType === "tv" && seasonNum && episodeNum && !contentData.isMovie) {
                const episode = contentData.episodes.find(ep => {
                  const epSeason = ep.s ? parseInt(ep.s.replace("S", "")) : ep.season;
                  const epNumber = ep.ep ? parseInt(ep.ep.replace("E", "")) : ep.episode;
                  return epSeason === seasonNum && epNumber === episodeNum;
                });
                
                if (episode && episode.id) {
                  targetContentId = episode.id;
                  console.log(`[NetMirror] Found episode ID: ${targetContentId}`);
                }
              }
              
              return getStreamingLinks(targetContentId, title, platform);
            })
            .then(function(streamData) {
              if (!streamData.sources || streamData.sources.length === 0) {
                console.log(`[NetMirror] No streaming links found on ${platform}`);
                return tryPlatform(platformIndex + 1);
              }
              
              // Convert to standard stream format
              const streams = streamData.sources.map((source, index) => {
                let quality = source.quality || "HD";
                const qualityMatch = quality.match(/(\d{3,4})p/i);
                if (qualityMatch) {
                  quality = qualityMatch[1] + "p";
                }
                
                let streamTitle = `${title} ${year ? `(${year})` : ""} ${quality}`;
                if (mediaType === "tv" && seasonNum && episodeNum) {
                  streamTitle += ` S${seasonNum}E${episodeNum}`;
                }
                
                return {
                  name: `NetMirror (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                  title: streamTitle,
                  url: source.url,
                  quality: quality,
                  type: source.type.includes("mpegURL") ? "hls" : "direct",
                  headers: {
                    "Referer": `${NETMIRROR_BASE}tv/home`,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                  }
                };
              });
              
              // Sort by quality
              streams.sort((a, b) => {
                const parseQuality = (q) => {
                  const match = q.match(/(\d{3,4})p/i);
                  return match ? parseInt(match[1]) : 0;
                };
                return parseQuality(b.quality) - parseQuality(a.quality);
              });
              
              console.log(`[NetMirror] Successfully found ${streams.length} streams on ${platform}`);
              return streams;
            })
            .catch(function(error) {
              console.log(`[NetMirror] Error on ${platform}: ${error.message}`);
              return tryPlatform(platformIndex + 1);
            });
        })
        .catch(function(error) {
          console.log(`[NetMirror] Error searching ${platform}: ${error.message}`);
          return tryPlatform(platformIndex + 1);
        });
    }
    
    return tryPlatform(0);
  }).catch(function(error) {
    console.error(`[NetMirror] Error in getStreams: ${error.message}`);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
