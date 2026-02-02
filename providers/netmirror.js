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

console.log("[NetMirror] Initializing NetMirror provider (V8: Origin Fix + OkHttp)");

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

// 🌍 DOMAIN CONFIGURATION
const API_BASE_DISNEY = "https://net20.cc/";
const API_BASE_GENERIC = "https://net51.cc/";
const CDN_BASE = "https://net52.cc/"; // Working CDN

// 🤖 USER-AGENTS
// API_UA: Needs to look like a phone browser to pass Cloudflare/DDoS checks
const API_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
// STREAM_UA: Needs to look like a generic player library to avoid TLS mismatch
const STREAM_UA = "okhttp/4.12.0";

const BASE_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent": API_UA,
  "Accept": "application/json, text/plain, */*",
  "Connection": "keep-alive"
};

function getApiBase(platform) {
  return platform.toLowerCase() === "disney" ? API_BASE_DISNEY : API_BASE_GENERIC;
}

function getReferer(platform, isPlaylist = false) {
  if (platform.toLowerCase() === "disney") {
    return isPlaylist ? API_BASE_DISNEY : `${API_BASE_DISNEY}home`;
  }
  return `${API_BASE_GENERIC}tv/home`;
}

function makeRequest(url, options = {}) {
  // Add timestamp to prevent caching
  const finalUrl = url + (url.includes('?') ? '&' : '?') + `_=${Date.now()}`;
  
  return fetch(finalUrl, __spreadProps(__spreadValues({}, options), {
    headers: __spreadValues(__spreadValues({}, BASE_HEADERS), options.headers),
    timeout: 15000,
    cache: "no-store"
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
  const targetBase = getApiBase(platform);
  const referer = getReferer(platform);
  
  // NOTE: Added 'Origin' header here which is crucial for POST requests
  const bypassHeaders = {
    "Referer": referer,
    "Origin": targetBase.slice(0, -1) // Remove trailing slash for Origin
  };

  console.log(`[NetMirror] Generating token on ${targetBase}...`);

  function attemptBypass(attempts) {
    if (attempts >= 3) throw new Error("Max bypass attempts reached");

    return makeRequest(`${targetBase}tv/p.php`, {
      method: "POST",
      headers: __spreadProps(__spreadValues({}, BASE_HEADERS), bypassHeaders)
    }).then(function(response) {
      const setCookieHeader = response.headers.get("set-cookie");
      let extractedCookie = null;
      if (setCookieHeader) {
        const cookieString = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : setCookieHeader;
        const cookieMatch = cookieString.match(/t_hash_t=([^;]+)/);
        if (cookieMatch) extractedCookie = cookieMatch[1];
      }
      return response.text().then(function(responseText) {
        if (!responseText.includes('"r":"n"') && !extractedCookie) {
           return delay(1000).then(() => attemptBypass(attempts + 1));
        }
        if (extractedCookie) {
          if (extractedCookie.startsWith("d944fd")) {
             console.log("[NetMirror] Warning: Stale token detected. Retrying...");
             return delay(1500).then(() => attemptBypass(attempts + 1));
          }
          return extractedCookie;
        }
        throw new Error("Failed to extract authentication cookie");
      });
    });
  }
  return attemptBypass(0);
}

function searchContent(query, platform) {
  const apiBase = getApiBase(platform);
  const referer = getReferer(platform);

  return bypass(platform).then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "ott": platform.toLowerCase() === "disney" ? "hs" : (platform.toLowerCase() === "primevideo" ? "pv" : "nf"),
      "hd": "on"
    };
    if (platform.toLowerCase() !== "disney") cookies["user_token"] = "a0a5f663894ade410614071fe46baca6";

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
  const apiBase = getApiBase(platform);
  const referer = getReferer(platform);

  return bypass(platform).then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "ott": platform.toLowerCase() === "disney" ? "hs" : (platform.toLowerCase() === "primevideo" ? "pv" : "nf"),
      "hd": "on"
    };
    if (platform.toLowerCase() !== "disney") cookies["user_token"] = "a0a5f663894ade410614071fe46baca6";
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    const episodesEndpoints = {
      "netflix": `${apiBase}episodes.php`,
      "primevideo": `${apiBase}pv/episodes.php`,
      "disney": `${apiBase}mobile/hs/episodes.php`
    };
    const episodesUrl = episodesEndpoints[platform.toLowerCase()] || episodesEndpoints["netflix"];

    const episodes = [];
    function fetchPage(pageNum) {
      return makeRequest(
        `${episodesUrl}?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${pageNum}`, {
          headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
            "Cookie": cookieString,
            "Referer": referer
          })
        }
      ).then(r => r.json()).then(function(episodeData) {
        if (episodeData.episodes) episodes.push(...episodeData.episodes);
        if (episodeData.nextPageShow === 0) return episodes;
        else return fetchPage(pageNum + 1);
      }).catch(() => episodes);
    }
    return fetchPage(page || 1);
  });
}

function loadContent(contentId, platform) {
  const apiBase = getApiBase(platform);
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
          .then((more) => allEpisodes.push(...more));
      }
      if (postData.season && postData.season.length > 1) {
        postData.season.slice(0, -1).forEach(season => {
          episodePromise = episodePromise.then(() => getEpisodesFromSeason(contentId, season.id, platform, 1))
            .then((more) => allEpisodes.push(...more));
        });
      }
      return episodePromise.then(() => ({
        id: contentId,
        title: postData.title,
        episodes: allEpisodes,
        seasons: postData.season || [],
        isMovie: !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null
      }));
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
  const apiBase = getApiBase(platform);
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
      return { sources: [], subtitles: [] };
    }

    const sources = [];
    const subtitles = [];

    playlist.forEach((item) => {
      if (item.sources) {
        item.sources.forEach((source) => {
          let fullUrl = source.file;

          // 1. URL Cleanup
          if (platform.toLowerCase() === "netflix" && fullUrl.includes("/tv/")) {
            fullUrl = fullUrl.replace("://net51.cc/tv/", "://net51.cc/").replace(/^\/tv\//, "/");
          }

          // 2. Resolve to NET52.CC
          try {
            if (fullUrl.startsWith('//')) fullUrl = 'https:' + fullUrl;
            else if (!fullUrl.startsWith('http')) fullUrl = new URL(fullUrl, CDN_BASE).href;
          } catch (e) {
            if (!fullUrl.startsWith('http')) fullUrl = CDN_BASE + fullUrl.replace(/^\//, '');
          }
          
          // Force replacement of bad CDN
          if (fullUrl.includes("net51.cc")) fullUrl = fullUrl.replace("net51.cc", "net52.cc");

          let quality = "HD";
          let label = (source.label || "").toLowerCase();
          if (label === "auto" || label === "master") quality = "1080p (Auto)";
          else if (label.includes("1080") || label.includes("full")) quality = "1080p";
          else if (label.includes("720")) quality = "720p";
          else if (label.includes("480")) quality = "480p";

          sources.push({
            url: fullUrl,
            quality: quality,
            type: source.type || "application/x-mpegURL"
          });
        });
      }

      if (item.tracks) {
        item.tracks.filter((track) => track.kind === "captions").forEach((track) => {
          let fullSubUrl = track.file;
          try {
            if (fullSubUrl.startsWith('//')) fullSubUrl = 'https:' + fullSubUrl;
            else if (!fullSubUrl.startsWith('http')) fullSubUrl = new URL(fullSubUrl, CDN_BASE).href;
            if (fullSubUrl.includes("net51.cc")) fullSubUrl = fullSubUrl.replace("net51.cc", "net52.cc");
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
}

function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror] Fetching streams for TMDB ID: ${tmdbId}`);
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
      if (platformIndex >= platforms.length) return [];
      const platform = platforms[platformIndex];

      function trySearch(withYear) {
        const searchQuery = withYear ? `${title} ${year}` : title;
        return searchContent(searchQuery, platform).then(function(searchResults) {
          if (searchResults.length === 0) {
            if (!withYear && year) return trySearch(true);
            return null;
          }

          const relevantResults = searchResults.filter((result) => {
            if (calculateSimilarity(result.title, title) < 0.5) return false;
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
            let targetId = contentData.id;
            
            if (mediaType === "tv") {
              if(contentData.isMovie) return null;
              const epData = contentData.episodes.find((ep) => {
                let s = 1, e = 1;
                if (ep.s && ep.ep) { s = parseInt(ep.s.replace("S","")); e = parseInt(ep.ep.replace("E","")); }
                else if (ep.season && ep.episode) { s = parseInt(ep.season); e = parseInt(ep.episode); }
                return s === (seasonNum || 1) && e === (episodeNum || 1);
              });
              if (epData) targetId = epData.id;
              else return null;
            }

            return getStreamingLinks(targetId, title, platform).then(function(streamData) {
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
                  headers: {
                    // Use okhttp User-Agent to pass player checks
                    "User-Agent": STREAM_UA,
                    "Referer": CDN_BASE,
                    "Cookie": "hd=on"
                  }
                };
              });

              streams.sort((a, b) => {
                const score = (q) => {
                  if (q.includes("Auto")) return 10000;
                  if (q.includes("1080")) return 1080;
                  return 0;
                };
                return score(b.quality) - score(a.quality);
              });
              return streams;
            });
          });
        });
      }
      return trySearch(false).then(res => res || tryPlatform(platformIndex + 1)).catch(() => tryPlatform(platformIndex + 1));
    }
    return tryPlatform(0);
  }).catch(e => {
      console.error(e);
      return [];
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams };
else global.getStreams = getStreams;
