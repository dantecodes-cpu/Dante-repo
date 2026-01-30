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

console.log("[NetMirror] Initializing NetMirror provider (Multi-Domain Fix)");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const NETMIRROR_BASE = "https://net51.cc/";
const DISNEY_BASE = "https://net20.cc/";

const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive"
};

// 🍪 STORE COOKIES SEPARATELY PER DOMAIN
// This prevents net51 cookies from being sent to net20 (which causes failures)
const cookieStore = {
  "https://net51.cc/": { value: "", timestamp: 0 },
  "https://net20.cc/": { value: "", timestamp: 0 }
};
const COOKIE_EXPIRY = 54e6; // ~15 hours

// Helper to get the correct API domain
function getBaseUrl(platform) {
  return platform.toLowerCase() === "disney" ? DISNEY_BASE : NETMIRROR_BASE;
}

// Helper to get the correct Referer based on platform
function getReferer(platform, isPlaylist = false) {
  if (platform.toLowerCase() === "disney") {
    // Playlist specifically requires root Referer for HS
    return isPlaylist ? DISNEY_BASE : `${DISNEY_BASE}home`;
  }
  return `${NETMIRROR_BASE}tv/home`;
}

function makeRequest(url, options = {}) {
  return fetch(url, __spreadProps(__spreadValues({}, options), {
    headers: __spreadValues(__spreadValues({}, BASE_HEADERS), options.headers),
    timeout: 15000 // Extended timeout
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

function bypass(platform) {
  const targetBase = getBaseUrl(platform);
  const now = Date.now();
  const cached = cookieStore[targetBase];

  // Check valid cached cookie for this specific domain
  if (cached.value && cached.timestamp && now - cached.timestamp < COOKIE_EXPIRY) {
    return Promise.resolve(cached.value);
  }

  console.log(`[NetMirror] Bypassing authentication on ${targetBase}...`);

  function attemptBypass(attempts) {
    if (attempts >= 3) {
      throw new Error("Max bypass attempts reached");
    }

    // HS bypass referer: net20.cc/home
    // Others: net51.cc/tv/home
    const referer = getReferer(platform);

    return makeRequest(`${targetBase}tv/p.php`, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
        "Referer": referer
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
        // Retry if response doesn't look like success ("r":"n") AND we didn't get a cookie header
        if (!responseText.includes('"r":"n"') && !extractedCookie) {
          console.log(`[NetMirror] Bypass attempt ${attempts + 1} failed. Retrying...`);
          return delay(1500).then(() => attemptBypass(attempts + 1));
        }
        
        if (extractedCookie) {
          // Store cookie for this specific domain
          cookieStore[targetBase] = {
            value: extractedCookie,
            timestamp: Date.now()
          };
          console.log(`[NetMirror] Authentication successful for ${platform}`);
          return extractedCookie;
        }
        throw new Error("Failed to extract authentication cookie");
      });
    });
  }
  return attemptBypass(0);
}

function searchContent(query, platform) {
  console.log(`[NetMirror] Searching for "${query}" on ${platform}...`);
  const apiBase = getBaseUrl(platform);
  const referer = getReferer(platform);

  return bypass(platform).then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "ott": platform.toLowerCase() === "disney" ? "hs" : (platform.toLowerCase() === "primevideo" ? "pv" : "nf"),
      "hd": "on"
    };
    
    // Kotlin code confirms user_token is NOT sent for Disney
    if (platform.toLowerCase() !== "disney") {
      cookies["user_token"] = "a0a5f663894ade410614071fe46baca6";
    }

    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");

    const searchEndpoints = {
      "netflix": `${apiBase}search.php`,
      "primevideo": `${apiBase}pv/search.php`,
      "disney": `${apiBase}mobile/hs/search.php`
    };
    const searchUrl = searchEndpoints[platform.toLowerCase()] || searchEndpoints["netflix"];

    return makeRequest(
      `${searchUrl}?s=${encodeURIComponent(query)}&t=${getUnixTime()}`, {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": referer
        })
      }
    );
  }).then(r => r.json()).then(function(searchData) {
    if (searchData.searchResult && searchData.searchResult.length > 0) {
      console.log(`[NetMirror] Found ${searchData.searchResult.length} results`);
      return searchData.searchResult.map((item) => {
        let imgHost = "https://imgcdn.media";
        // Disney often uses imgcdn.kim
        if (platform.toLowerCase() === 'disney') imgHost = "https://imgcdn.kim";

        return {
          id: item.id,
          title: item.t,
          posterUrl: `${imgHost}/hs/v/${item.id}.jpg`.replace('/hs/', platform.toLowerCase() === 'disney' ? '/hs/' : '/poster/')
        };
      });
    } else {
      console.log("[NetMirror] No results found");
      return [];
    }
  });
}

function getEpisodesFromSeason(seriesId, seasonId, platform, page) {
  const apiBase = getBaseUrl(platform);
  const referer = getReferer(platform);

  return bypass(platform).then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "ott": platform.toLowerCase() === "disney" ? "hs" : (platform.toLowerCase() === "primevideo" ? "pv" : "nf"),
      "hd": "on"
    };
    if (platform.toLowerCase() !== "disney") cookies["user_token"] = "a0a5f663894ade410614071fe46baca6";

    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    const episodes = [];

    const episodesEndpoints = {
      "netflix": `${apiBase}episodes.php`,
      "primevideo": `${apiBase}pv/episodes.php`,
      "disney": `${apiBase}mobile/hs/episodes.php`
    };
    const episodesUrl = episodesEndpoints[platform.toLowerCase()] || episodesEndpoints["netflix"];

    function fetchPage(pageNum) {
      return makeRequest(
        `${episodesUrl}?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${pageNum}`, {
          headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
            "Cookie": cookieString,
            "Referer": referer
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
    return fetchPage(page || 1);
  });
}

function loadContent(contentId, platform) {
  const apiBase = getBaseUrl(platform);
  const referer = getReferer(platform);

  return bypass(platform).then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "ott": platform.toLowerCase() === "disney" ? "hs" : (platform.toLowerCase() === "primevideo" ? "pv" : "nf"),
      "hd": "on"
    };
    if (platform.toLowerCase() !== "disney") cookies["user_token"] = "a0a5f663894ade410614071fe46baca6";

    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");

    const postEndpoints = {
      "netflix": `${apiBase}post.php`,
      "primevideo": `${apiBase}pv/post.php`,
      "disney": `${apiBase}mobile/hs/post.php`
    };
    const postUrl = postEndpoints[platform.toLowerCase()] || postEndpoints["netflix"];

    return makeRequest(
      `${postUrl}?id=${contentId}&t=${getUnixTime()}`, {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": referer
        })
      }
    );
  }).then(r => r.json()).then(function(postData) {
    let allEpisodes = postData.episodes || [];
    let episodePromise = Promise.resolve();

    if (postData.episodes && postData.episodes.length > 0 && postData.episodes[0] !== null) {
      if (postData.nextPageShow === 1 && postData.nextPageSeason) {
        episodePromise = episodePromise.then(() => getEpisodesFromSeason(contentId, postData.nextPageSeason, platform, 2))
          .then((more) => {
            allEpisodes.push(...more);
          });
      }

      if (postData.season && postData.season.length > 1) {
        postData.season.slice(0, -1).forEach(season => {
          episodePromise = episodePromise.then(() => getEpisodesFromSeason(contentId, season.id, platform, 1))
            .then((more) => {
              allEpisodes.push(...more);
            });
        });
      }

      return episodePromise.then(function() {
        return {
          id: contentId,
          title: postData.title,
          episodes: allEpisodes,
          seasons: postData.season || [],
          isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
        };
      });
    }

    return {
      id: contentId,
      title: postData.title,
      episodes: allEpisodes,
      seasons: postData.season || [],
      isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
    };
  });
}

function getStreamingLinks(contentId, title, platform) {
  console.log(`[NetMirror] Getting streaming links for: ${title} (${platform})`);
  const apiBase = getBaseUrl(platform);
  // Important: HS uses root as referer for playlist, others use /tv/home
  const referer = getReferer(platform, true);

  return bypass(platform).then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "hd": "on",
      "ott": platform.toLowerCase() === "disney" ? "hs" : (platform.toLowerCase() === "primevideo" ? "pv" : "nf")
    };
    if (platform.toLowerCase() !== "disney") cookies["user_token"] = "a0a5f663894ade410614071fe46baca6";

    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    let playlistUrl;

    if (platform.toLowerCase() === "primevideo") playlistUrl = `${apiBase}tv/pv/playlist.php`;
    else if (platform.toLowerCase() === "disney") playlistUrl = `${apiBase}mobile/hs/playlist.php`;
    else playlistUrl = `${apiBase}tv/playlist.php`;

    return makeRequest(
      `${playlistUrl}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`, {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": referer
        })
      }
    );
  }).then(r => r.json()).then(function(playlist) {
    if (!Array.isArray(playlist) || playlist.length === 0) {
      console.log("[NetMirror] No streaming links found");
      return {
        sources: [],
        subtitles: []
      };
    }

    const sources = [];
    const subtitles = [];

    playlist.forEach((item) => {
      // Process Video Sources
      if (item.sources) {
        item.sources.forEach((source) => {
          let fullUrl = source.file;

          // 1. URL CORRECTION
          // Netflix weird path fix
          if (platform.toLowerCase() === "netflix" && fullUrl.includes("/tv/")) {
            fullUrl = fullUrl.replace("://net51.cc/tv/", "://net51.cc/").replace(/^\/tv\//, "/");
          }

          // 2. ABSOLUTE URL CONSTRUCTION
          // Even if API was net20, stream is usually on net51 CDN (or relative path needs a base)
          // The Kotlin code uses `newUrl` (net51.cc) to construct the link.
          try {
            if (fullUrl.startsWith('//')) fullUrl = 'https:' + fullUrl;
            else if (!fullUrl.startsWith('http')) {
              // ALWAYS resolve against NETMIRROR_BASE (net51) for streams
              fullUrl = new URL(fullUrl, NETMIRROR_BASE).href;
            }
          } catch (e) {
            // Fallback
            if (!fullUrl.startsWith('http')) fullUrl = NETMIRROR_BASE + fullUrl.replace(/^\//, '');
          }

          // 3. QUALITY DETECTION
          let quality = "HD";
          let label = (source.label || "").toLowerCase();

          if (label === "auto" || label === "master") quality = "1080p (Auto)";
          else if (label.includes("1080") || label.includes("full") || label.includes("fhd")) quality = "1080p";
          else if (label.includes("720") || label.includes("hd")) quality = "720p";
          else if (label.includes("480") || label.includes("sd")) quality = "480p";

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
          } catch (e) {}

          subtitles.push({
            url: fullSubUrl,
            language: track.label || "English"
          });
        });
      }
    });

    console.log(`[NetMirror] Found ${sources.length} sources.`);
    return {
      sources,
      subtitles
    };
  });
}

function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;

  return makeRequest(tmdbUrl).then(r => r.json()).then(function(tmdbData) {
    var _a, _b;
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? (_a = tmdbData.first_air_date) == null ? void 0 : _a.substring(0, 4) : (_b = tmdbData.release_date) == null ? void 0 : _b.substring(0, 4);
    
    if (!title) throw new Error("Could not extract title from TMDB");
    console.log(`[NetMirror] TMDB Info: "${title}" (${year})`);

    // HEURISTIC: Platform Priority
    let platforms = ["netflix", "primevideo", "disney"];
    const tLower = title.toLowerCase();
    
    if (tLower.includes("boys") || tLower.includes("prime") || tLower.includes("reacher")) {
      platforms = ["primevideo", "netflix", "disney"];
    } else if (tLower.includes("mandalorian") || tLower.includes("marvel") || tLower.includes("iron") || tLower.includes("star wars")) {
      platforms = ["disney", "netflix", "primevideo"];
    }

    function calculateSimilarity(str1, str2) {
      const s1 = str1.toLowerCase().trim();
      const s2 = str2.toLowerCase().trim();
      if (s1 === s2) return 1;
      return s1.includes(s2) || s2.includes(s1) ? 0.8 : 0; // Simplified
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

          // Strict filtering
          const relevantResults = searchResults.filter((result) => {
            const similarity = calculateSimilarity(result.title, title);
            if (similarity < 0.5) return false;
            
            if (mediaType === "tv") {
                if(result.title.toLowerCase().includes("movie")) return false;
            }
            return true;
          });

          if (relevantResults.length === 0) {
             if (!withYear && year) return trySearch(true);
             return null;
          }

          const selectedContent = relevantResults[0];
          console.log(`[NetMirror] Selected: ${selectedContent.title} (ID: ${selectedContent.id})`);

          return loadContent(selectedContent.id, platform).then(function(contentData) {
            
            // Handle TV Show Episode Selection
            let targetContentId = contentData.id;
            
            if (mediaType === "tv") {
              if(contentData.isMovie) {
                  // Mismatch type
                  console.log("[NetMirror] Expected TV but got Movie type result.");
                  return null;
              }

              const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
              const episodeData = validEpisodes.find((ep) => {
                let epSeason = 1, epNumber = 1;
                // Parse episode structure (S01E01 or similar)
                if (ep.s && ep.ep) {
                  epSeason = parseInt(ep.s.replace("S", ""));
                  epNumber = parseInt(ep.ep.replace("E", ""));
                } else if (ep.season && ep.episode) {
                  epSeason = parseInt(ep.season);
                  epNumber = parseInt(ep.episode);
                }
                return epSeason === (seasonNum || 1) && epNumber === (episodeNum || 1);
              });

              if (episodeData) {
                targetContentId = episodeData.id;
              } else {
                console.log(`[NetMirror] Episode S${seasonNum}E${episodeNum} not found.`);
                return null;
              }
            }

            return getStreamingLinks(targetContentId, title, platform).then(function(streamData) {
              if (!streamData.sources || streamData.sources.length === 0) return null;

              const streams = streamData.sources.map((source) => {
                let streamTitle = `${title} ${source.quality}`;
                if (mediaType === "tv") streamTitle += ` S${seasonNum}E${episodeNum}`;

                return {
                  name: `NetMirror (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                  title: streamTitle,
                  url: source.url,
                  quality: source.quality,
                  type: "hls",
                  headers: {
                    "User-Agent": BASE_HEADERS["User-Agent"],
                    "Referer": NETMIRROR_BASE // Stream referer is usually net51
                  }
                };
              });

              // Sort Priority: 1080p (Auto) > 1080p > 720p > 480p
              streams.sort((a, b) => {
                const score = (q) => {
                  if (q.includes("Auto")) return 10000;
                  if (q.includes("1080")) return 1080;
                  if (q.includes("720")) return 720;
                  return 0;
                };
                return score(b.quality) - score(a.quality);
              });

              return streams;
            });
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
  module.exports = {
    getStreams
  };
} else {
  global.getStreams = getStreams;
}
