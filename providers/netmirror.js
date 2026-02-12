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

console.log("[NetMirror] Initializing NetMirror provider (Title & Link Fix)");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const MAIN_URL = "https://net22.cc";    // Search, Metadata, Auth
const STREAM_URL = "https://net52.cc";  // Streaming, Playlist

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
    timeout: 10000 
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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function bypass() {
  const now = Date.now();
  if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
    return Promise.resolve(globalCookie);
  }
  console.log("[NetMirror] Bypassing authentication...");
  
  function attemptBypass(attempts) {
    if (attempts >= 4) { 
      throw new Error("Max bypass attempts reached");
    }
    
    return makeRequest(`${MAIN_URL}/tv/p.php`, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
        "Referer": `${MAIN_URL}/tv/home`
      })
    }).then(function(response) {
      const setCookieHeader = response.headers.get("set-cookie");
      let extractedCookie = null;
      if (setCookieHeader) {
        const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader;
        const cookieMatch = cookieString.match(/t_hash_t=([^;]+)/);
        if (cookieMatch) {
          extractedCookie = cookieMatch[1];
        }
      }
      return response.text().then(function(responseText) {
        if (!responseText.includes('"r":"n"')) {
          console.log(`[NetMirror] Bypass attempt ${attempts + 1} failed. Retrying...`);
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

function getVideoToken(contentId, cookieString) {
    return makeRequest(`${MAIN_URL}/play.php`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": cookieString,
            "Referer": `${MAIN_URL}/`
        },
        body: `id=${contentId}`
    }).then(r => r.json()).then(json => {
        const hParam = json.h; 
        return makeRequest(`${STREAM_URL}/play.php?id=${contentId}&${hParam}`, {
            headers: {
                "Cookie": cookieString,
                "Referer": `${MAIN_URL}/`, 
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
            }
        });
    }).then(r => r.text()).then(html => {
        const match = html.match(/data-h="([^"]+)"/);
        if (match && match[1]) {
            return match[1];
        }
        throw new Error("Failed to extract video token");
    });
}

function searchContent(query, platform) {
  console.log(`[NetMirror] Searching for "${query}" on ${platform}...`);
  const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(function(cookie) {
    let cookies = {
      "t_hash_t": cookie,
      "ott": ott,
      "hd": "on"
    };
    if (ott === "nf") {
        cookies["user_token"] = "233123f803cf02184bf6c67e149cdd50";
    }

    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const searchEndpoints = {
      "netflix": `${MAIN_URL}/search.php`,
      "primevideo": `${MAIN_URL}/pv/search.php`,
      "disney": `${MAIN_URL}/mobile/hs/search.php`
    };
    const searchUrl = searchEndpoints[platform.toLowerCase()] || searchEndpoints["netflix"];
    
    return makeRequest(
      `${searchUrl}?s=${encodeURIComponent(query)}&t=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${MAIN_URL}/tv/home`
        })
      }
    );
  }).then(r => r.json()).then(function(searchData) {
    if (searchData.searchResult && searchData.searchResult.length > 0) {
      return searchData.searchResult.map((item) => ({
        id: item.id,
        title: item.t,
        posterUrl: `https://imgcdn.media/poster/v/${item.id}.jpg`
      }));
    } else {
      return [];
    }
  });
}

function getEpisodesFromSeason(seriesId, seasonId, platform, page) {
  const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(function(cookie) {
    let cookies = {
      "t_hash_t": cookie,
      "ott": ott,
      "hd": "on"
    };
    if (ott === "nf") cookies["user_token"] = "233123f803cf02184bf6c67e149cdd50";

    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    const episodes = [];
    let currentPage = page || 1;
    
    const episodesEndpoints = {
      "netflix": `${MAIN_URL}/episodes.php`,
      "primevideo": `${MAIN_URL}/pv/episodes.php`,
      "disney": `${MAIN_URL}/mobile/hs/episodes.php`
    };
    const episodesUrl = episodesEndpoints[platform.toLowerCase()] || episodesEndpoints["netflix"];
    
    function fetchPage(pageNum) {
      return makeRequest(
        `${episodesUrl}?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${pageNum}`,
        {
          headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
            "Cookie": cookieString,
            "Referer": `${MAIN_URL}/tv/home`
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
  const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(function(cookie) {
    let cookies = {
      "t_hash_t": cookie,
      "ott": ott,
      "hd": "on"
    };
    if (ott === "nf") cookies["user_token"] = "233123f803cf02184bf6c67e149cdd50";

    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const postEndpoints = {
      "netflix": `${MAIN_URL}/post.php`,
      "primevideo": `${MAIN_URL}/pv/post.php`,
      "disney": `${MAIN_URL}/mobile/hs/post.php`
    };
    const postUrl = postEndpoints[platform.toLowerCase()] || postEndpoints["netflix"];
    
    return makeRequest(
      `${postUrl}?id=${contentId}&t=${getUnixTime()}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${MAIN_URL}/tv/home`
        })
      }
    );
  }).then(r => r.json()).then(function(postData) {
    let allEpisodes = postData.episodes || [];
    
    if (postData.episodes && postData.episodes.length > 0 && postData.episodes[0] !== null) {
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
          title: postData.title, // Internal Source Title
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
      title: postData.title, // Internal Source Title
      description: postData.desc,
      year: postData.year,
      episodes: allEpisodes,
      seasons: postData.season || [],
      isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
    };
  });
}

function getStreamingLinks(contentId, title, platform) {
  // IMPORTANT: 'title' here must be the Internal Source Title from post.php, NOT TMDB title.
  console.log(`[NetMirror] Getting streaming links for: ${title} (${platform})`);
  const ottMap = { "netflix": "nf", "primevideo": "pv", "disney": "hs" };
  const ott = ottMap[platform.toLowerCase()] || "nf";
  
  return bypass().then(async function(cookie) {
    let cookies = {
      "t_hash_t": cookie,
      "hd": "on",
      "ott": ott
    };
    if (ott === "nf") cookies["user_token"] = "233123f803cf02184bf6c67e149cdd50";

    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    let playlistUrl;
    let token = "";

    if (ott === "nf") {
        try {
            token = await getVideoToken(contentId, cookieString);
        } catch (e) {
            console.error("Token generation failed:", e);
        }
    }
    
    let reqReferer = "";
    
    if (platform.toLowerCase() === "primevideo") {
        playlistUrl = `${STREAM_URL}/pv/playlist.php`;
        reqReferer = `${STREAM_URL}/home`; 
    } else if (platform.toLowerCase() === "disney") {
        playlistUrl = `${STREAM_URL}/mobile/hs/playlist.php`;
        reqReferer = `${MAIN_URL}/`; // CRITICAL: Fix for in=unknown error
    } else {
        playlistUrl = `${STREAM_URL}/playlist.php`;
        reqReferer = `${STREAM_URL}/`;
    }

    let finalUrl = `${playlistUrl}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`;
    if (ott === "nf" && token) {
        finalUrl += `&h=${token}`;
    }

    return makeRequest(
      finalUrl,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": reqReferer
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
      if (item.sources) {
        item.sources.forEach((source) => {
          let fullUrl = source.file;
          
          if (platform.toLowerCase() === "netflix" && fullUrl.includes("/tv/")) {
             fullUrl = fullUrl.replace("://net52.cc/tv/", "://net52.cc/").replace(/^\/tv\//, "/");
          }
          
          // Strict Absolute URL Construction
          if (!fullUrl.startsWith('http')) {
              const cleanPath = fullUrl.startsWith('/') ? fullUrl.substring(1) : fullUrl;
              fullUrl = `${STREAM_URL}/${cleanPath}`;
          } else if (fullUrl.startsWith('//')) {
              fullUrl = 'https:' + fullUrl;
          }

          let quality = "HD";
          let label = (source.label || "").toLowerCase();
          
          if (label === "auto" || label === "master") quality = "1080p (Auto)";
          else if (label.includes("1080") || label.includes("full") || label.includes("fhd")) quality = "1080p";
          else if (label.includes("720") || label.includes("hd")) quality = "720p";
          else if (label.includes("480") || label.includes("sd")) quality = "480p";
          
          // Streaming Headers (Cookies are needed for playback)
          const streamHeaders = {
              "Accept": "*/*",
              "Referer": `${STREAM_URL}/`
          };

          if (platform.toLowerCase() === "disney") {
              streamHeaders["Cookie"] = "hd=on"; 
              streamHeaders["User-Agent"] = BASE_HEADERS["User-Agent"];
          } else {
              streamHeaders["Cookie"] = "hd=on";
              streamHeaders["User-Agent"] = "Mozilla/5.0 (Android) ExoPlayer"; 
          }
          
          sources.push({
            url: fullUrl,
            quality: quality,
            type: source.type || "application/x-mpegURL",
            headers: streamHeaders
          });
        });
      }
      
      if (item.tracks) {
        item.tracks.filter((track) => track.kind === "captions").forEach((track) => {
          let fullSubUrl = track.file;
          try {
             if (fullSubUrl.startsWith('//')) fullSubUrl = 'https:' + fullSubUrl;
             else if (!fullSubUrl.startsWith('http')) fullSubUrl = new URL(fullSubUrl, STREAM_URL).href;
          } catch(e) {}
          
          subtitles.push({
            url: fullSubUrl,
            language: track.label || "English"
          });
        });
      }
    });
    
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
            // FIX: Use the actual Source Title (NetMirror's title) instead of TMDB title for playlist request
            const sourceTitle = contentData.title;

            if (mediaType === "tv" && contentData.isMovie) {
               if (relevantResults.length > 1) {
                  return loadContent(relevantResults[1].id, platform).then(next => {
                      if(next.isMovie) return null;
                      return processContent(next, relevantResults[1].id, next.title);
                  });
               }
               return null;
            }
            return processContent(contentData, selectedContent.id, sourceTitle);
            
            function processContent(contentData, contentId, realTitle) {
              let targetContentId = contentId;
              
              if (mediaType === "tv" && !contentData.isMovie) {
                const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
                const episodeData = validEpisodes.find((ep) => {
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
                  return epSeason === (seasonNum || 1) && epNumber === (episodeNum || 1);
                });
                
                if (episodeData) {
                  targetContentId = episodeData.id;
                } else {
                  console.log(`[NetMirror] Episode S${seasonNum}E${episodeNum} not found`);
                  return null;
                }
              }
              
              // Pass realTitle (from source) to getStreamingLinks to avoid "in=unknown" errors
              return getStreamingLinks(targetContentId, realTitle, platform).then(function(streamData) {
                if (!streamData.sources || streamData.sources.length === 0) return null;
                
                const streams = streamData.sources.map((source) => {
                  let streamTitle = `${title} ${source.quality}`; // Display title can be TMDB title
                  if (mediaType === "tv") {
                    streamTitle += ` S${seasonNum}E${episodeNum}`;
                  }
                  
                  return {
                    name: `NetMirror (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                    title: streamTitle,
                    url: source.url,
                    quality: source.quality,
                    type: "hls", 
                    headers: source.headers
                  };
                });
                
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
