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

console.log("[NetMirror] Initializing NetMirror provider (V10 - Deployment Ready)");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// --- CONFIGURATION ---
const NETMIRROR_BASE = "https://net52.cc/"; 
const DISNEY_BASE = "https://net22.cc/";

// Master Key (Verified Working)
const MASTER_HASH = "988a734da1152ddea2c25c8904eede20%3A%3A0cb4f3935641c828678b8946867997e5%3A%3A1768993531%3A%3Ani";
// User Token (Added for Disney/Cloudstream compatibility)
const USER_TOKEN = "e362149021200003b137f8280f55098e"; 

const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive"
};

const cookieStore = {
  "https://net52.cc/": { value: "", timestamp: 0 },
  "https://net22.cc/": { value: "", timestamp: 0 }
};
const COOKIE_EXPIRY = 54e6; 

function getBaseUrl(platform) {
  return platform.toLowerCase() === "disney" ? DISNEY_BASE : NETMIRROR_BASE;
}

// FIX: Strict Referer Logic
function getReferer(platform, isPlaylist = false) {
  const base = getBaseUrl(platform);
  if (platform.toLowerCase() === "disney") {
    // Disney Mobile API (hs) STRICTLY requires Root referer for Search/Playlist
    // Using /home causes Search to return 0 results
    return base; 
  }
  // Netflix/Prime TV API expects /tv/home
  return `${base}tv/home`;
}

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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function bypass(platform) {
  const targetBase = getBaseUrl(platform);
  const now = Date.now();

  // Cleanup old cookies
  if (cookieStore["https://net51.cc/"]) delete cookieStore["https://net51.cc/"];
  if (cookieStore["https://net20.cc/"]) delete cookieStore["https://net20.cc/"];

  if (!cookieStore[targetBase]) {
      cookieStore[targetBase] = { value: "", timestamp: 0 };
  }
  
  const cached = cookieStore[targetBase];
  if (cached.value && cached.timestamp && now - cached.timestamp < COOKIE_EXPIRY) {
    return Promise.resolve(cached.value);
  }

  console.log(`[NetMirror] Authenticating on ${targetBase}...`);

  function attemptBypass(attempts) {
    if (attempts >= 3) throw new Error("Max auth attempts reached");

    let authUrl;
    if (platform.toLowerCase() === "disney") {
        authUrl = `${targetBase}mobile/hs/p.php`;
    } else {
        authUrl = `${targetBase}tv/p.php`;
    }

    return makeRequest(authUrl, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": getReferer(platform) // Use correct referer
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
         return delay(1000).then(() => attemptBypass(attempts + 1));
      }
      
      cookieStore[targetBase] = {
        value: tHash,
        timestamp: Date.now()
      };
      
      console.log(`[NetMirror] Auth successful.`);
      return tHash;
    });
  }
  return attemptBypass(0);
}

function getFullCookie(platform, dynamicHash) {
    const ott = platform.toLowerCase() === "disney" ? "hs" : (platform.toLowerCase() === "primevideo" ? "pv" : "nf");
    // Added user_token for compatibility
    return `t_hash_t=${MASTER_HASH}; t_hash=${dynamicHash}; ott=${ott}; hd=on; user_token=${USER_TOKEN}`;
}

function searchContent(query, platform) {
  const apiBase = getBaseUrl(platform);
  // FIX: Disney Search needs Root Referer
  const referer = getReferer(platform);

  return bypass(platform).then(function(dynamicHash) {
    const cookieString = getFullCookie(platform, dynamicHash);

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
        let imgHost = "https://imgcdn.media";
        if (platform.toLowerCase() === 'disney') imgHost = "https://imgcdn.kim";

        return {
          id: item.id,
          title: item.t,
          posterUrl: `${imgHost}/hs/v/${item.id}.jpg`.replace('/hs/', platform.toLowerCase() === 'disney' ? '/hs/' : '/poster/')
        };
      });
    }
    return [];
  });
}

function getEpisodesFromSeason(seriesId, seasonId, platform, page) {
  const apiBase = getBaseUrl(platform);
  const referer = getReferer(platform);

  return bypass(platform).then(function(dynamicHash) {
    const cookieString = getFullCookie(platform, dynamicHash);
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
        return episodes;
      });
    }
    return fetchPage(page || 1);
  });
}

function loadContent(contentId, platform) {
  const apiBase = getBaseUrl(platform);
  const referer = getReferer(platform);

  return bypass(platform).then(function(dynamicHash) {
    const cookieString = getFullCookie(platform, dynamicHash);

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
  const referer = getReferer(platform, true);

  return bypass(platform).then(function(dynamicHash) {
    const cookieString = getFullCookie(platform, dynamicHash);
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
    ).then(r => r.json()).then(function(playlist) {
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

            // FIX: Absolute URL conversion + Domain Rewrite
            try {
                if (fullUrl.startsWith('//')) fullUrl = 'https:' + fullUrl;
                else if (!fullUrl.startsWith('http')) {
                    // Handle relative paths like /tv/hls/123.m3u8
                    fullUrl = new URL(fullUrl, apiBase).href;
                }

                // Rewrite domain to match Auth (Fixes Manifest Malformed)
                const urlObj = new URL(fullUrl);
                const currentBaseObj = new URL(apiBase);
                if (urlObj.hostname !== currentBaseObj.hostname) {
                    fullUrl = fullUrl.replace(urlObj.hostname, currentBaseObj.hostname);
                }
            } catch (e) {
                // Safe Fallback
                if(apiBase.includes("net52") && fullUrl.includes("net51")) fullUrl = fullUrl.replace("net51.cc", "net52.cc");
            }

            let quality = "HD";
            let label = (source.label || "").toLowerCase();

            if (label === "auto" || label === "master") quality = "1080p (Auto)";
            else if (label.includes("1080") || label.includes("full")) quality = "1080p";
            else if (label.includes("720")) quality = "720p";
            else if (label.includes("480")) quality = "480p";

            sources.push({
              url: fullUrl,
              quality: quality,
              type: source.type || "application/x-mpegURL",
              headers: {
                "User-Agent": BASE_HEADERS["User-Agent"],
                "Referer": referer,
                "Cookie": cookieString
              }
            });
          });
        }

        if (item.tracks) {
          item.tracks.filter((track) => track.kind === "captions").forEach((track) => {
            let fullSubUrl = track.file;
            try {
              if (fullSubUrl.startsWith('//')) fullSubUrl = 'https:' + fullSubUrl;
              else if (!fullSubUrl.startsWith('http')) fullSubUrl = new URL(fullSubUrl, NETMIRROR_BASE).href;
               // Domain fix for subs
               if (fullSubUrl.includes("net51")) fullSubUrl = fullSubUrl.replace("net51.cc", "net52.cc");
               if (fullSubUrl.includes("net20")) fullSubUrl = fullSubUrl.replace("net20.cc", "net22.cc");
            } catch (e) {}

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
    console.log(`[NetMirror] TMDB Info: "${title}" (${year})`);

    let platforms = ["netflix", "primevideo", "disney"];
    const tLower = title.toLowerCase();
    
    if (tLower.includes("boys") || tLower.includes("prime") || tLower.includes("reacher")) {
      platforms = ["primevideo", "netflix", "disney"];
    } else if (tLower.includes("mandalorian") || tLower.includes("marvel") || tLower.includes("iron") || tLower.includes("star wars") || tLower.includes("bad batch")) {
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

          const relevantResults = searchResults.filter((result) => {
            const similarity = calculateSimilarity(result.title, title);
            if (similarity < 0.5) return false;
            if (mediaType === "tv" && result.title.toLowerCase().includes("movie")) return false;
            return true;
          });

          if (relevantResults.length === 0) {
             if (!withYear && year) return trySearch(true);
             return null;
          }

          const selectedContent = relevantResults[0];
          console.log(`[NetMirror] Selected: ${selectedContent.title} (ID: ${selectedContent.id}) on ${platform}`);

          return loadContent(selectedContent.id, platform).then(function(contentData) {
            let targetContentId = contentData.id;
            
            if (mediaType === "tv") {
              if(contentData.isMovie) return null; 

              const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
              const episodeData = validEpisodes.find((ep) => {
                let epSeason = 1, epNumber = 1;
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
                  name: `NetMirror (${platform.toUpperCase()})`,
                  title: streamTitle,
                  url: source.url,
                  quality: source.quality,
                  type: "hls",
                  headers: source.headers // Inherit headers with cookies
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
