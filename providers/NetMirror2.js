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
  }).then(function(response) {
    return response.json();
  }).then(function(searchData) {
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
  const ottMap = {
    "netflix": "nf",
    "primevideo": "pv",
    "disney": "hs"
  };
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
      ).then(function(response) {
        return response.json();
      }).then(function(episodeData) {
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
  }).then(function(response) {
    return response.json();
  }).then(function(postData) {
    console.log(`[NetMirror] Loaded: ${postData.title}`);
    let allEpisodes = postData.episodes || [];
    if (postData.episodes && postData.episodes.length > 0 && postData.episodes[0] !== null) {
      console.log("[NetMirror] Loading episodes from all seasons...");
      let episodePromise = Promise.resolve();
      if (postData.nextPageShow === 1 && postData.nextPageSeason) {
        episodePromise = episodePromise.then(function() {
          return getEpisodesFromSeason(contentId, postData.nextPageSeason, platform, 2);
        }).then(function(additionalEpisodes) {
          allEpisodes.push(...additionalEpisodes);
        });
      }
      if (postData.season && postData.season.length > 1) {
        const otherSeasons = postData.season.slice(0, -1);
        otherSeasons.forEach(function(season) {
          episodePromise = episodePromise.then(function() {
            return getEpisodesFromSeason(contentId, season.id, platform, 1);
          }).then(function(seasonEpisodes) {
            allEpisodes.push(...seasonEpisodes);
          });
        });
      }
      return episodePromise.then(function() {
        console.log(`[NetMirror] Loaded ${allEpisodes.filter((ep) => ep !== null).length} total episodes`);
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
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "hd": "on",
      "ott": ott
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    let playlistUrl;
    if (platform.toLowerCase() === "primevideo") {
      playlistUrl = `${NETMIRROR_BASE}tv/pv/playlist.php`;
    } else if (platform.toLowerCase() === "disney") {
      playlistUrl = `${NETMIRROR_BASE}mobile/hs/playlist.php`;
    } else {
      playlistUrl = `${NETMIRROR_BASE}tv/playlist.php`;
    }
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
          
          // 🔧 Netflix path fix: remove `/tv/` ONLY for Netflix
          if (platform.toLowerCase() === "netflix") {
            fullUrl = fullUrl
              .replace("://net51.cc/tv/", "://net51.cc/")
              .replace(/^\/tv\//, "/");
          }
          
          // ✅ ONLY fix RELATIVE URLs
          if (!fullUrl.startsWith("http")) {
            if (fullUrl.startsWith("//")) {
              fullUrl = "https:" + fullUrl;
            } else {
              fullUrl = "https://net51.cc" + fullUrl;
            }
          }
          // ❌ Do NOTHING else to the URL
          
          sources.push({
            url: fullUrl,
            quality: source.label,
            type: source.type || "application/x-mpegURL"
          });
        });
      }
      if (item.tracks) {
        item.tracks.filter((track) => track.kind === "captions").forEach((track) => {
          let fullSubUrl = track.file;
          if (track.file.startsWith("/") && !track.file.startsWith("//")) {
            fullSubUrl = NETMIRROR_BASE + track.file;
          } else if (track.file.startsWith("//")) {
            fullSubUrl = "https:" + track.file;
          }
          subtitles.push({
            url: fullSubUrl,
            language: track.label
          });
        });
      }
    });
    console.log(`[NetMirror] Found ${sources.length} streaming sources and ${subtitles.length} subtitle tracks`);
    
    // Debug log for PrimeVideo URLs
    if (platform.toLowerCase() === "primevideo" && sources.length > 0) {
      console.log(`[NetMirror] PrimeVideo sample URL: ${sources[0].url}`);
    }
    
    return { sources, subtitles };
  });
}
function findEpisodeId(episodes, season, episode) {
  if (!episodes || episodes.length === 0) {
    console.log("[NetMirror] No episodes found in content data");
    return null;
  }
  const validEpisodes = episodes.filter((ep) => ep !== null);
  console.log(`[NetMirror] Found ${validEpisodes.length} valid episodes`);
  if (validEpisodes.length > 0) {
    console.log(`[NetMirror] Sample episode structure:`, JSON.stringify(validEpisodes[0], null, 2));
  }
  const targetEpisode = validEpisodes.find((ep) => {
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
    } else {
      console.log(`[NetMirror] Unknown episode format:`, ep);
      return false;
    }
    console.log(`[NetMirror] Checking episode S${epSeason}E${epNumber} against target S${season}E${episode}`);
    return epSeason === season && epNumber === episode;
  });
  if (targetEpisode) {
    console.log(`[NetMirror] Found target episode:`, targetEpisode);
    return targetEpisode.id;
  } else {
    console.log(`[NetMirror] Target episode S${season}E${episode} not found`);
    return null;
  }
}
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ""}`);
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  return makeRequest(tmdbUrl).then(function(tmdbResponse) {
    return tmdbResponse.json();
  }).then(function(tmdbData) {
    var _a, _b;
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? (_a = tmdbData.first_air_date) == null ? void 0 : _a.substring(0, 4) : (_b = tmdbData.release_date) == null ? void 0 : _b.substring(0, 4);
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    console.log(`[NetMirror] TMDB Info: "${title}" (${year})`);
    
    // Try different search strategies based on media type
    let searchStrategies = [];
    
    if (mediaType === "tv") {
      // For TV shows, try multiple strategies to find the right one
      searchStrategies = [
        { query: title, desc: "Title only" },
        { query: `${title} ${year}`, desc: "Title with year" },
        { query: `${title} season 1`, desc: "Title with season" },
        { query: `${title} s01`, desc: "Title with season number" }
      ];
    } else {
      // For movies, simpler approach
      searchStrategies = [
        { query: title, desc: "Title only" },
        { query: `${title} ${year}`, desc: "Title with year" }
      ];
    }
    
    let platforms = ["netflix", "primevideo", "disney"];
    if (title.toLowerCase().includes("boys") || title.toLowerCase().includes("prime")) {
      platforms = ["primevideo", "netflix", "disney"];
    }
    
    console.log(`[NetMirror] Will try ${searchStrategies.length} search strategies`);
    
    // Improved similarity calculation - simpler but effective
    function calculateSimilarity(str1, str2) {
      const s1 = str1.toLowerCase().trim();
      const s2 = str2.toLowerCase().trim();
      
      // Exact match is best
      if (s1 === s2) return 1;
      
      // Word-based matching
      const words1 = s1.split(/[\s\-.,:;()]+/).filter((w) => w.length > 0);
      const words2 = s2.split(/[\s\-.,:;()]+/).filter((w) => w.length > 0);
      
      let exactMatches = 0;
      for (const queryWord of words2) {
        if (words1.includes(queryWord)) {
          exactMatches++;
        }
      }
      
      // Calculate match percentage
      return exactMatches / Math.max(words1.length, words2.length);
    }
    
    function filterRelevantResults(searchResults, query) {
      const filtered = searchResults.filter((result) => {
        const similarity = calculateSimilarity(result.title, query);
        return similarity >= 0.4; // Lower threshold to catch more results
      });
      
      return filtered.sort((a, b) => {
        const simA = calculateSimilarity(a.title, query);
        const simB = calculateSimilarity(b.title, query);
        return simB - simA;
      });
    }
    
    function tryPlatform(platformIndex) {
      if (platformIndex >= platforms.length) {
        console.log("[NetMirror] No content found on any platform");
        return [];
      }
      const platform = platforms[platformIndex];
      console.log(`[NetMirror] Trying platform: ${platform}`);
      
      function trySearch(strategyIndex) {
        if (strategyIndex >= searchStrategies.length) {
          console.log(`[NetMirror] All search strategies exhausted for ${platform}`);
          return null;
        }
        
        const strategy = searchStrategies[strategyIndex];
        console.log(`[NetMirror] Strategy ${strategyIndex + 1}/${searchStrategies.length}: "${strategy.query}" (${strategy.desc})`);
        
        return searchContent(strategy.query, platform).then(function(searchResults) {
          if (searchResults.length === 0) {
            console.log(`[NetMirror] No results, trying next strategy...`);
            return trySearch(strategyIndex + 1);
          }
          
          const relevantResults = filterRelevantResults(searchResults, title);
          if (relevantResults.length === 0) {
            console.log(`[NetMirror] Found ${searchResults.length} results but none were relevant enough, trying next strategy...`);
            return trySearch(strategyIndex + 1);
          }
          
          // For TV shows, try to filter out movies
          let filteredResults = relevantResults;
          if (mediaType === "tv") {
            filteredResults = relevantResults.filter(result => {
              const lowerTitle = result.title.toLowerCase();
              // Skip results that look like movies
              const movieIndicators = ["(202", "(201", "(200", "(199", "(198"];
              if (movieIndicators.some(indicator => lowerTitle.includes(indicator))) {
                // Check if it's actually a TV series by looking for season indicators
                const seasonIndicators = ["season", "s01", "s1", "s02", "s2", "series"];
                if (!seasonIndicators.some(indicator => lowerTitle.includes(indicator))) {
                  console.log(`[NetMirror] Skipping movie result: ${result.title}`);
                  return false;
                }
              }
              return true;
            });
            
            if (filteredResults.length === 0) {
              console.log(`[NetMirror] All results filtered out as movies, trying next strategy...`);
              return trySearch(strategyIndex + 1);
            }
          }
          
          const selectedContent = filteredResults[0];
          console.log(`[NetMirror] Selected: ${selectedContent.title} (ID: ${selectedContent.id}) - from ${filteredResults.length} filtered results`);
          
          return loadContent(selectedContent.id, platform).then(function(contentData) {
            // Verify content type matches (but be less strict)
            if (mediaType === "tv") {
              // Check if it has episodes/seasons
              if (contentData.isMovie && contentData.seasons.length === 0) {
                console.log(`[NetMirror] Selected content appears to be a movie, trying next strategy...`);
                return trySearch(strategyIndex + 1);
              }
            }
            
            let targetContentId = selectedContent.id;
            let episodeData = null;
            
            if (mediaType === "tv" && !contentData.isMovie) {
              const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
              episodeData = validEpisodes.find((ep) => {
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
                console.log(`[NetMirror] Found episode ID: ${episodeData.id}`);
              } else {
                console.log(`[NetMirror] Episode S${seasonNum}E${episodeNum} not found, trying next strategy...`);
                return trySearch(strategyIndex + 1);
              }
            }
            
            return getStreamingLinks(targetContentId, title, platform).then(function(streamData) {
              if (!streamData.sources || streamData.sources.length === 0) {
                console.log(`[NetMirror] No streaming links found, trying next strategy...`);
                return trySearch(strategyIndex + 1);
              }
              
              const streams = streamData.sources.map((source) => {
                let quality = "HD";
                const urlQualityMatch = source.url.match(/[?&]q=(\d+p)/i);
                if (urlQualityMatch) {
                  quality = urlQualityMatch[1];
                } else if (source.quality) {
                  const labelQualityMatch = source.quality.match(/(\d+p)/i);
                  if (labelQualityMatch) {
                    quality = labelQualityMatch[1];
                  } else {
                    const normalizedQuality = source.quality.toLowerCase();
                    if (normalizedQuality.includes("full hd") || normalizedQuality.includes("1080")) {
                      quality = "1080p";
                    } else if (normalizedQuality.includes("hd") || normalizedQuality.includes("720")) {
                      quality = "720p";
                    } else if (normalizedQuality.includes("480")) {
                      quality = "480p";
                    } else {
                      quality = source.quality;
                    }
                  }
                } else if (source.url.includes("720p")) {
                  quality = "720p";
                } else if (source.url.includes("480p")) {
                  quality = "480p";
                } else if (source.url.includes("1080p")) {
                  quality = "1080p";
                }
                
                let streamTitle = `${title} ${year ? `(${year})` : ""} ${quality}`;
                if (mediaType === "tv") {
                  const episodeName = episodeData && episodeData.t ? episodeData.t : "";
                  streamTitle += ` S${seasonNum}E${episodeNum}`;
                  if (episodeName) {
                    streamTitle += ` - ${episodeName}`;
                  }
                }
                
                // ✅ Correct headers - ALWAYS include Referer (Cloudstream behavior)
                const streamHeaders = {
                  "User-Agent": "Mozilla/5.0 (Linux; Android 13)",
                  "Accept": "*/*",
                  "Referer": "https://net51.cc/"
                };
                
                return {
                  name: `NetMirror (${platform.charAt(0).toUpperCase() + platform.slice(1)})`,
                  title: streamTitle,
                  url: source.url,
                  quality,
                  type: source.type.includes("mpegURL") ? "hls" : "direct",
                  headers: streamHeaders
                };
              });
              
              streams.sort((a, b) => {
                if (a.quality.toLowerCase() === "auto" && b.quality.toLowerCase() !== "auto") {
                  return -1;
                }
                if (b.quality.toLowerCase() === "auto" && a.quality.toLowerCase() !== "auto") {
                  return 1;
                }
                const parseQuality = (quality) => {
                  const match = quality.match(/(\d{3,4})p/i);
                  return match ? parseInt(match[1], 10) : 0;
                };
                const qualityA = parseQuality(a.quality);
                const qualityB = parseQuality(b.quality);
                return qualityB - qualityA;
              });
              
              console.log(`[NetMirror] Successfully processed ${streams.length} streams from ${platform}`);
              return streams;
            });
          });
        });
      }
      
      return trySearch(0).then(function(result) {
        if (result) {
          return result;
        } else {
          console.log(`[NetMirror] No content found on ${platform}, trying next platform`);
          return tryPlatform(platformIndex + 1);
        }
      }).catch(function(error) {
        console.log(`[NetMirror] Error on ${platform}: ${error.message}, trying next platform`);
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
