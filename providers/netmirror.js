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

console.log("[NetMirror] Initializing Provider (V12 - Kotlin Parity)");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// --- CONFIGURATION BASED ON KOTLIN ---
// Kotlin: mainUrl = "https://net22.cc" (For Search, Load, Auth)
// Kotlin: newUrl  = "https://net52.cc" (For Playlists, Streams)
const META_BASE = "https://net22.cc/"; 
const STREAM_BASE = "https://net52.cc/"; 

// Hashes from CloudStream Kotlin Source
const MASTER_HASH = "988a734da1152ddea2c25c8904eede20%3A%3A0cb4f3935641c828678b8946867997e5%3A%3A1768993531%3A%3Ani";
const USER_TOKEN = "233123f803cf02184bf6c67e149cdd50"; // Updated from Kotlin NetflixProvider

const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36",
  "Accept": "*/*",
  "Connection": "keep-alive"
};

const cookieStore = {
  "https://net22.cc/": { value: "", timestamp: 0 }
};
const COOKIE_EXPIRY = 54e6; 

function makeRequest(url, options = {}) {
  return fetch(url, __spreadProps(__spreadValues({}, options), {
    headers: __spreadValues(__spreadValues({}, BASE_HEADERS), options.headers),
    timeout: 15000
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

// FIX: Kotlin uses net22.cc for Auth
function bypass() {
  const targetBase = META_BASE;
  const now = Date.now();

  const cached = cookieStore[targetBase];
  if (cached && cached.value && cached.timestamp && now - cached.timestamp < COOKIE_EXPIRY) {
    return Promise.resolve(cached.value);
  }

  console.log(`[NetMirror] Authenticating on ${targetBase}...`);

  function attemptBypass(attempts) {
    if (attempts >= 3) throw new Error("Max auth attempts reached");

    // Standard TV auth endpoint works for general session
    const authUrl = `${targetBase}tv/p.php`;

    return makeRequest(authUrl, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": `${targetBase}home`
      }),
      body: "init=1"
    }).then(function(response) {
      const setCookieHeader = response.headers.get("set-cookie");
      let tHash = null;
      
      if (setCookieHeader) {
        const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader;
        const match = cookieString.match(/t_hash=([^;]+)/);
        if (match) tHash = match[1];
      }

      if (!tHash) {
         console.log(`[NetMirror] Auth failed. Retrying...`);
         return new Promise(resolve => setTimeout(resolve, 1000)).then(() => attemptBypass(attempts + 1));
      }
      
      cookieStore[targetBase] = {
        value: tHash,
        timestamp: Date.now()
      };
      
      console.log(`[NetMirror] Auth successful. Hash: ${tHash.substring(0, 10)}...`);
      return tHash;
    });
  }
  return attemptBypass(0);
}

// FIX: Constructed exactly like Kotlin mapOf()
function getCookieString(platform, dynamicHash) {
    const ott = platform.toLowerCase() === "disney" ? "hs" : (platform.toLowerCase() === "primevideo" ? "pv" : "nf");
    // Kotlin: "t_hash_t" to cookie_value, "ott" to "hs", "hd" to "on", "user_token"
    // Note: We include both t_hash keys to be safe, Kotlin uses t_hash_t
    return `t_hash_t=${dynamicHash || MASTER_HASH}; t_hash=${dynamicHash}; ott=${ott}; hd=on; user_token=${USER_TOKEN}`;
}

function searchContent(query, platform) {
  // Kotlin: uses mainUrl (net22) for search
  const apiBase = META_BASE; 
  const referer = `${META_BASE}home`;

  return bypass().then(function(dynamicHash) {
    const cookieString = getCookieString(platform, dynamicHash);

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
      return searchData.searchResult.map((item) => {
        // Kotlin: posterUrl = "https://imgcdn.kim/hs/v/$id.jpg"
        let imgHost = "https://imgcdn.kim";
        let posterPath = `/poster/v/${item.id}.jpg`;
        
        if (platform.toLowerCase() === 'disney') posterPath = `/hs/v/${item.id}.jpg`;
        if (platform.toLowerCase() === 'primevideo') posterPath = `/pv/v/${item.id}.jpg`;

        return {
          id: item.id,
          title: item.t,
          posterUrl: `${imgHost}${posterPath}`
        };
      });
    }
    return [];
  });
}

function loadContent(contentId, platform) {
  // Kotlin: uses mainUrl (net22) for loading details
  const apiBase = META_BASE;
  const referer = `${META_BASE}home`;

  return bypass().then(function(dynamicHash) {
    const cookieString = getCookieString(platform, dynamicHash);

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
    
    // Logic for seasons (simplified for brevity, assumes data structure is valid)
    // Note: If you need pagination logic for episodes, insert it here using the same META_BASE
    
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
  
  // FIX: Kotlin uses newUrl (net52.cc) for Playlist API
  const apiBase = STREAM_BASE; 
  // Kotlin: referer = "$mainUrl/" (net22) or "$newUrl/" depending on provider. 
  // Safest is net22/home or root
  const referer = `${META_BASE}`; 

  return bypass().then(function(dynamicHash) {
    const cookieString = getCookieString(platform, dynamicHash);
    let playlistUrl;

    if (platform.toLowerCase() === "primevideo") playlistUrl = `${apiBase}pv/playlist.php`;
    else if (platform.toLowerCase() === "disney") playlistUrl = `${apiBase}mobile/hs/playlist.php`;
    else playlistUrl = `${apiBase}playlist.php`;

    return makeRequest(
      `${playlistUrl}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`, {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": referer
        })
      }
    ).then(r => r.json()).then(function(playlist) {
      if (!Array.isArray(playlist) || playlist.length === 0) {
        return { sources: [], subtitles: [] };
      }

      const sources = [];
      const subtitles = [];

      playlist.forEach((item) => {
        if (item.sources) {
          item.sources.forEach((source) => {
            // FIX: Kotlin Logic: "$newUrl/${it.file}"
            // We append the file directly to STREAM_BASE (net52.cc)
            let fullUrl = source.file;
            if (!fullUrl.startsWith('http')) {
                // Handle leading slash if present or not
                const cleanPath = fullUrl.startsWith('/') ? fullUrl.substring(1) : fullUrl;
                fullUrl = `${STREAM_BASE}${cleanPath}`;
            }

            let quality = "HD";
            let label = (source.label || "").toLowerCase();

            if (label === "auto" || label === "master") quality = "1080p (Auto)";
            else if (label.includes("1080")) quality = "1080p";
            else if (label.includes("720")) quality = "720p";
            else if (label.includes("480")) quality = "480p";

            // FIX: Headers from Kotlin VideoInterceptor
            // Kotlin: .header("Cookie", "hd=on") is crucial for the m3u8 request
            sources.push({
              url: fullUrl,
              quality: quality,
              type: source.type || "application/x-mpegURL",
              headers: {
                "User-Agent": BASE_HEADERS["User-Agent"],
                "Referer": `${STREAM_BASE}`, // Kotlin: referer = "$newUrl/"
                "Cookie": "hd=on", // CRITICAL FIX for 403 Error
                "Connection": "keep-alive"
              }
            });
          });
        }

        if (item.tracks) {
          item.tracks.filter((track) => track.kind === "captions").forEach((track) => {
            let fullSubUrl = track.file;
            if (fullSubUrl && !fullSubUrl.startsWith('http')) {
                 fullSubUrl = `${STREAM_BASE}${fullSubUrl.startsWith('/') ? fullSubUrl.substring(1) : fullSubUrl}`;
            }
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
    
    let platforms = ["netflix", "primevideo", "disney"];
    const tLower = title.toLowerCase();
    
    // Priority adjustments based on content
    if (tLower.includes("boys") || tLower.includes("prime") || tLower.includes("reacher")) {
      platforms = ["primevideo", "netflix", "disney"];
    } else if (tLower.includes("mandalorian") || tLower.includes("marvel") || tLower.includes("star wars")) {
      platforms = ["disney", "netflix", "primevideo"];
    }

    function calculateSimilarity(str1, str2) {
      const s1 = str1.toLowerCase().trim();
      const s2 = str2.toLowerCase().trim();
      if (s1 === s2) return 1;
      return s1.includes(s2) || s2.includes(s1) ? 0.8 : 0; 
    }

    function tryPlatform(platformIndex) {
      if (platformIndex >= platforms.length) {
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

          const relevantResults = searchResults.filter((result) => {
            const similarity = calculateSimilarity(result.title, title);
            return similarity >= 0.5;
          });

          if (relevantResults.length === 0) {
             if (!withYear && year) return trySearch(true);
             return null;
          }

          const selectedContent = relevantResults[0];
          console.log(`[NetMirror] Selected: ${selectedContent.title} on ${platform}`);

          return loadContent(selectedContent.id, platform).then(function(contentData) {
            let targetContentId = contentData.id;
            
            if (mediaType === "tv") {
              if(contentData.isMovie) return null; 

              const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
              const episodeData = validEpisodes.find((ep) => {
                let epSeason = 0, epNumber = 0;
                
                // Normalizing episode data from different endpoints
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
                return null;
              }
            }

            return getStreamingLinks(targetContentId, title, platform).then(function(streamData) {
              if (!streamData.sources || streamData.sources.length === 0) return null;

              const streams = streamData.sources.map((source) => {
                let streamTitle = `${title} ${source.quality}`;
                if (mediaType === "tv") streamTitle += ` S${seasonNum}E${episodeNum}`;

                return {
                  name: `NetMirror (${platform.toUpperCase()})`,
                  title: streamTitle,
                  url: source.url,
                  quality: source.quality,
                  type: "hls",
                  headers: source.headers 
                };
              });

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
      }).catch(e => {
        console.error(`Error on ${platform}:`, e);
        return tryPlatform(platformIndex + 1);
      });
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
