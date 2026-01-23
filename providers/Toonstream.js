// PrimeVideo Mirror Provider
console.log("[NetMirror] Initializing PrimeVideo provider");

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
const PLATFORM = "primevideo";
const OTT = "pv"; // PrimeVideo OTT code

// Utility functions
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

// PrimeVideo-specific bypass
function bypass() {
  const now = Date.now();
  if (globalCookie && cookieTimestamp && now - cookieTimestamp < COOKIE_EXPIRY) {
    console.log("[NetMirror-PrimeVideo] Using cached authentication cookie");
    return Promise.resolve(globalCookie);
  }
  console.log("[NetMirror-PrimeVideo] Bypassing authentication...");
  
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
          console.log(`[NetMirror-PrimeVideo] Bypass attempt ${attempts + 1} failed, retrying...`);
          return attemptBypass(attempts + 1);
        }
        if (extractedCookie) {
          globalCookie = extractedCookie;
          cookieTimestamp = Date.now();
          console.log("[NetMirror-PrimeVideo] Authentication successful");
          return globalCookie;
        }
        throw new Error("Failed to extract authentication cookie");
      });
    });
  }
  return attemptBypass(0);
}

// PrimeVideo-specific search
function searchContent(query) {
  console.log(`[NetMirror-PrimeVideo] Searching for "${query}"...`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6", // PrimeVideo token
      "ott": OTT,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}pv/search.php?s=${encodeURIComponent(query)}&t=${getUnixTime()}`,
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
      console.log(`[NetMirror-PrimeVideo] Found ${searchData.searchResult.length} results`);
      return searchData.searchResult.map((item) => ({
        id: item.id,
        title: item.t,
        platform: PLATFORM,
        posterUrl: `https://imgcdn.media/pv/v/${item.id}.jpg`
      }));
    } else {
      console.log("[NetMirror-PrimeVideo] No results found");
      return [];
    }
  });
}

// PrimeVideo-specific episode loading
function getEpisodesFromSeason(seriesId, seasonId, page = 1) {
  console.log(`[NetMirror-PrimeVideo] Loading episodes for season ${seasonId}, page ${page}`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "ott": OTT,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}pv/episodes.php?s=${seasonId}&series=${seriesId}&t=${getUnixTime()}&page=${page}`,
      {
        headers: __spreadProps(__spreadValues({}, BASE_HEADERS), {
          "Cookie": cookieString,
          "Referer": `${NETMIRROR_BASE}tv/home`
        })
      }
    );
  }).then(function(response) {
    return response.json();
  }).then(function(episodeData) {
    const episodes = episodeData.episodes || [];
    
    // Check if there are more pages
    if (episodeData.nextPageShow === 1) {
      return getEpisodesFromSeason(seriesId, seasonId, page + 1).then(function(nextPageEpisodes) {
        return episodes.concat(nextPageEpisodes);
      });
    }
    
    return episodes;
  }).catch(function(error) {
    console.log(`[NetMirror-PrimeVideo] Failed to load episodes from season ${seasonId}, page ${page}`);
    return [];
  });
}

// Enhanced loadContent function for PrimeVideo
function loadContent(contentId) {
  console.log(`[NetMirror-PrimeVideo] Loading content details for ID: ${contentId}`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "ott": OTT,
      "hd": "on"
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}pv/post.php?id=${contentId}&t=${getUnixTime()}`,
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
    console.log(`[NetMirror-PrimeVideo] Loaded: ${postData.title}`);
    
    let allEpisodes = postData.episodes || [];
    const isMovie = !postData.episodes || postData.episodes.length === 0 || postData.episodes[0] === null;
    
    if (!isMovie && postData.episodes && postData.episodes.length > 0 && postData.episodes[0] !== null) {
      console.log("[NetMirror-PrimeVideo] Loading episodes from all seasons...");
      
      let episodePromise = Promise.resolve();
      
      // Load next page episodes if available
      if (postData.nextPageShow === 1 && postData.nextPageSeason) {
        episodePromise = episodePromise.then(function() {
          return getEpisodesFromSeason(contentId, postData.nextPageSeason, 2);
        }).then(function(additionalEpisodes) {
          allEpisodes = allEpisodes.concat(additionalEpisodes);
        });
      }
      
      // Load episodes from other seasons
      if (postData.season && postData.season.length > 1) {
        const otherSeasons = postData.season.slice(0, -1);
        otherSeasons.forEach(function(season) {
          episodePromise = episodePromise.then(function() {
            return getEpisodesFromSeason(contentId, season.id, 1);
          }).then(function(seasonEpisodes) {
            allEpisodes = allEpisodes.concat(seasonEpisodes);
          });
        });
      }
      
      return episodePromise.then(function() {
        console.log(`[NetMirror-PrimeVideo] Loaded ${allEpisodes.filter((ep) => ep !== null).length} total episodes`);
        return {
          id: contentId,
          title: postData.title,
          description: postData.desc,
          year: postData.year,
          episodes: allEpisodes.filter(ep => ep !== null),
          seasons: postData.season || [],
          isMovie: false,
          platform: PLATFORM
        };
      });
    }
    
    return {
      id: contentId,
      title: postData.title,
      description: postData.desc,
      year: postData.year,
      episodes: allEpisodes.filter(ep => ep !== null),
      seasons: postData.season || [],
      isMovie: isMovie,
      platform: PLATFORM
    };
  });
}

// PrimeVideo-specific streaming links
function getStreamingLinks(contentId, title) {
  console.log(`[NetMirror-PrimeVideo] Getting streaming links for: ${title}`);
  return bypass().then(function(cookie) {
    const cookies = {
      "t_hash_t": cookie,
      "user_token": "a0a5f663894ade410614071fe46baca6",
      "hd": "on",
      "ott": OTT
    };
    const cookieString = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
    
    return makeRequest(
      `${NETMIRROR_BASE}tv/pv/playlist.php?id=${contentId}&t=${encodeURIComponent(title)}&tm=${getUnixTime()}`,
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
      console.log("[NetMirror-PrimeVideo] No streaming links found");
      return { sources: [], subtitles: [] };
    }
    
    const sources = [];
    const subtitles = [];
    
    playlist.forEach((item) => {
      if (item.sources) {
        item.sources.forEach((source) => {
          let fullUrl = source.file;
          
          // PrimeVideo URLs should NOT be modified (Cloudstream behavior)
          // Only fix relative URLs
          if (!fullUrl.startsWith("http")) {
            if (fullUrl.startsWith("//")) {
              fullUrl = "https:" + fullUrl;
            } else if (fullUrl.startsWith("/")) {
              fullUrl = NETMIRROR_BASE + fullUrl.substring(1);
            }
          }
          
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
    
    console.log(`[NetMirror-PrimeVideo] Found ${sources.length} streaming sources and ${subtitles.length} subtitle tracks`);
    return { sources, subtitles };
  });
}

// Enhanced getStreams function for PrimeVideo with Cinemeta fixes
function getStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  console.log(`[NetMirror-PrimeVideo] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ""}`);
  
  // First try with TMDB API
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  
  return makeRequest(tmdbUrl).then(function(tmdbResponse) {
    return tmdbResponse.json();
  }).then(function(tmdbData) {
    const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
    const year = mediaType === "tv" ? (tmdbData.first_air_date || "").substring(0, 4) : (tmdbData.release_date || "").substring(0, 4);
    const originalTitle = tmdbData.original_title || tmdbData.original_name || title;
    
    if (!title) {
      throw new Error("Could not extract title from TMDB response");
    }
    
    console.log(`[NetMirror-PrimeVideo] TMDB Info: "${title}" (${year}), Original: "${originalTitle}"`);
    
    // Special handling for known problematic shows
    const specialHandling = getSpecialHandling(title, tmdbId);
    if (specialHandling) {
      console.log(`[NetMirror-PrimeVideo] Applying special handling for "${title}"`);
      return searchAndLoadSpecial(title, year, mediaType, seasonNum, episodeNum, specialHandling);
    }
    
    // For PrimeVideo, try multiple search strategies
    const searchStrategies = getSearchStrategies(title, year, mediaType, originalTitle);
    
    // Try each search strategy until we find results
    return trySearchStrategies(searchStrategies, 0).then(function(searchResults) {
      if (!searchResults || searchResults.length === 0) {
        console.log("[NetMirror-PrimeVideo] No content found after trying all strategies");
        
        // Fallback: Try direct search without TMDB matching
        return directTitleSearch(title, mediaType, seasonNum, episodeNum);
      }
      
      // Filter for this platform only
      const platformResults = searchResults.filter(result => result.platform === PLATFORM);
      if (platformResults.length === 0) {
        console.log("[NetMirror-PrimeVideo] No PrimeVideo content found in filtered results");
        return directTitleSearch(title, mediaType, seasonNum, episodeNum);
      }
      
      // Find the most relevant result
      const selectedContent = findMostRelevantResult(platformResults, title, mediaType, year);
      console.log(`[NetMirror-PrimeVideo] Selected: ${selectedContent.title} (ID: ${selectedContent.id})`);
      
      return loadContent(selectedContent.id).then(function(contentData) {
        if (mediaType === "tv" && contentData.isMovie) {
          console.log("[NetMirror-PrimeVideo] Content is a movie, but we're looking for TV series");
          return directTitleSearch(title, mediaType, seasonNum, episodeNum);
        }
        
        return processContentForStreaming(contentData, title, mediaType, seasonNum, episodeNum, year);
      });
    });
  }).catch(function(error) {
    console.error(`[NetMirror-PrimeVideo] TMDB error: ${error.message}, trying direct search...`);
    // Fallback to direct search if TMDB fails
    return directTitleSearch("The Boys", "tv", seasonNum, episodeNum);
  });
}

// Helper: Special handling for problematic shows
function getSpecialHandling(title, tmdbId) {
  const titleLower = title.toLowerCase();
  
  // Known problematic shows on PrimeVideo
  const specialCases = {
    "the boys": {
      searchTerms: [
        "The Boys", 
        "The Boys Season", 
        "The Boys S01",
        "The Boys Amazon",
        "The Boys TV Series"
      ],
      isTV: true,
      year: "2019"
    },
    "jack ryan": {
      searchTerms: [
        "Jack Ryan",
        "Tom Clancy's Jack Ryan",
        "Jack Ryan Season"
      ],
      isTV: true,
      year: "2018"
    },
    "the marvelous mrs. maisel": {
      searchTerms: [
        "The Marvelous Mrs. Maisel",
        "Marvelous Mrs Maisel",
        "Mrs Maisel"
      ],
      isTV: true,
      year: "2017"
    },
    "upload": {
      searchTerms: [
        "Upload",
        "Upload Season",
        "Upload Amazon"
      ],
      isTV: true,
      year: "2020"
    },
    "invincible": {
      searchTerms: [
        "Invincible",
        "Invincible Season",
        "Invincible Amazon"
      ],
      isTV: true,
      year: "2021"
    },
    "reacher": {
      searchTerms: [
        "Reacher",
        "Jack Reacher",
        "Reacher Season"
      ],
      isTV: true,
      year: "2022"
    },
    "good omens": {
      searchTerms: [
        "Good Omens",
        "Good Omens Season",
        "Good Omens Amazon"
      ],
      isTV: true,
      year: "2019"
    },
    "the terminal list": {
      searchTerms: [
        "The Terminal List",
        "Terminal List",
        "Terminal List Season"
      ],
      isTV: true,
      year: "2022"
    },
    "the wheel of time": {
      searchTerms: [
        "The Wheel of Time",
        "Wheel of Time",
        "Wheel of Time Season"
      ],
      isTV: true,
      year: "2021"
    },
    "the lord of the rings: the rings of power": {
      searchTerms: [
        "The Lord of the Rings: The Rings of Power",
        "Rings of Power",
        "Lord of the Rings Rings of Power"
      ],
      isTV: true,
      year: "2022"
    }
  };
  
  for (const [key, value] of Object.entries(specialCases)) {
    if (titleLower.includes(key)) {
      return value;
    }
  }
  
  return null;
}

// Helper: Special search and load for problematic shows
function searchAndLoadSpecial(title, year, mediaType, seasonNum, episodeNum, specialHandling) {
  const searchTerms = specialHandling.searchTerms;
  
  function trySpecialSearch(index) {
    if (index >= searchTerms.length) {
      console.log("[NetMirror-PrimeVideo] All special searches failed");
      return Promise.resolve([]);
    }
    
    const searchQuery = searchTerms[index];
    console.log(`[NetMirror-PrimeVideo] Special search ${index + 1}/${searchTerms.length}: "${searchQuery}"`);
    
    return searchContent(searchQuery).then(function(searchResults) {
      if (searchResults.length === 0) {
        return trySpecialSearch(index + 1);
      }
      
      // Filter for PrimeVideo only
      const platformResults = searchResults.filter(result => result.platform === PLATFORM);
      if (platformResults.length === 0) {
        return trySpecialSearch(index + 1);
      }
      
      // Get the first result (special searches are specific)
      const selectedContent = platformResults[0];
      console.log(`[NetMirror-PrimeVideo] Special match: ${selectedContent.title} (ID: ${selectedContent.id})`);
      
      return loadContent(selectedContent.id).then(function(contentData) {
        if (mediaType === "tv" && contentData.isMovie) {
          console.log("[NetMirror-PrimeVideo] Special content is a movie, trying next term");
          return trySpecialSearch(index + 1);
        }
        
        return processContentForStreaming(contentData, title, mediaType, seasonNum, episodeNum, year || specialHandling.year);
      });
    });
  }
  
  return trySpecialSearch(0);
}

// Helper: Direct title search (bypasses TMDB matching issues)
function directTitleSearch(title, mediaType, seasonNum, episodeNum) {
  console.log(`[NetMirror-PrimeVideo] Direct search for "${title}" (bypassing TMDB)`);
  
  // Try multiple search terms for direct search
  const directSearchTerms = [];
  
  if (mediaType === "tv") {
    // TV show search terms
    directSearchTerms.push(`${title} Season`);
    directSearchTerms.push(`${title} S01`);
    directSearchTerms.push(`${title} TV Series`);
    directSearchTerms.push(`${title} Amazon`);
    directSearchTerms.push(title);
  } else {
    // Movie search terms
    directSearchTerms.push(title);
    directSearchTerms.push(`${title} Movie`);
  }
  
  function tryDirectSearch(index) {
    if (index >= directSearchTerms.length) {
      console.log("[NetMirror-PrimeVideo] All direct searches failed");
      return Promise.resolve([]);
    }
    
    const searchQuery = directSearchTerms[index];
    console.log(`[NetMirror-PrimeVideo] Direct search ${index + 1}/${directSearchTerms.length}: "${searchQuery}"`);
    
    return searchContent(searchQuery).then(function(searchResults) {
      if (searchResults.length === 0) {
        return tryDirectSearch(index + 1);
      }
      
      // Filter for PrimeVideo only
      const platformResults = searchResults.filter(result => result.platform === PLATFORM);
      if (platformResults.length === 0) {
        return tryDirectSearch(index + 1);
      }
      
      // For direct search, we need to be more careful about relevance
      const selectedContent = findBestDirectMatch(platformResults, title, mediaType);
      console.log(`[NetMirror-PrimeVideo] Direct match: ${selectedContent.title} (ID: ${selectedContent.id})`);
      
      return loadContent(selectedContent.id).then(function(contentData) {
        // Verify content type
        if (mediaType === "tv" && contentData.isMovie) {
          console.log("[NetMirror-PrimeVideo] Direct match is a movie, trying next term");
          return tryDirectSearch(index + 1);
        }
        
        // Use a generic year for direct searches
        const estimatedYear = estimateYearFromTitle(selectedContent.title);
        
        return processContentForStreaming(contentData, title, mediaType, seasonNum, episodeNum, estimatedYear);
      });
    });
  }
  
  return tryDirectSearch(0);
}

// Helper: Find best match for direct search
function findBestDirectMatch(results, query, mediaType) {
  if (results.length === 1) return results[0];
  
  const queryLower = query.toLowerCase();
  const isTVSearch = mediaType === "tv";
  
  // Score each result
  const scoredResults = results.map(result => {
    const titleLower = result.title.toLowerCase();
    let score = 0;
    
    // Exact match bonus
    if (titleLower === queryLower) score += 100;
    
    // Contains the main title words
    const queryWords = queryLower.split(/\s+/).filter(word => word.length > 2);
    const titleWords = titleLower.split(/\s+/);
    
    let matchedWords = 0;
    queryWords.forEach(word => {
      if (titleWords.some(titleWord => titleWord.includes(word))) {
        matchedWords++;
      }
    });
    
    score += matchedWords * 15;
    
    // TV series indicators
    if (isTVSearch) {
      const tvIndicators = ["season", "s01", "s1", "s02", "s2", "series", "tv"];
      const hasTVIndicator = tvIndicators.some(indicator => titleLower.includes(indicator));
      
      if (hasTVIndicator) {
        score += 40;
      } else {
        // Penalize if it looks like a movie
        const movieIndicators = ["movie", "film", "(202", "(201", "(200", "(199"];
        if (movieIndicators.some(indicator => titleLower.includes(indicator))) {
          score -= 60;
        }
      }
    }
    
    // Length penalty (very long titles might be compilations)
    if (titleWords.length > 8) {
      score -= 20;
    }
    
    return { result, score };
  });
  
  // Sort by score
  scoredResults.sort((a, b) => b.score - a.score);
  
  // Log top 3 for debugging
  console.log("[NetMirror-PrimeVideo] Direct search top matches:");
  scoredResults.slice(0, 3).forEach((item, i) => {
    console.log(`  ${i + 1}. "${item.result.title}" - Score: ${item.score}`);
  });
  
  return scoredResults[0].result;
}

// Helper: Estimate year from title
function estimateYearFromTitle(title) {
  const yearMatch = title.match(/\((\d{4})\)/);
  if (yearMatch) {
    return yearMatch[1];
  }
  
  // Common years for popular shows
  const knownYears = {
    "the boys": "2019",
    "jack ryan": "2018",
    "the marvelous mrs. maisel": "2017",
    "upload": "2020",
    "invincible": "2021",
    "reacher": "2022",
    "good omens": "2019",
    "the terminal list": "2022",
    "the wheel of time": "2021",
    "the lord of the rings: the rings of power": "2022"
  };
  
  const titleLower = title.toLowerCase();
  for (const [show, year] of Object.entries(knownYears)) {
    if (titleLower.includes(show)) {
      return year;
    }
  }
  
  return "";
}

// Helper: Process content and get streaming links
function processContentForStreaming(contentData, title, mediaType, seasonNum, episodeNum, year) {
  let targetContentId = contentData.id;
  let episodeTitle = title;
  
  // For TV shows, find the specific episode
  if (mediaType === "tv" && !contentData.isMovie) {
    const validEpisodes = contentData.episodes.filter((ep) => ep !== null);
    console.log(`[NetMirror-PrimeVideo] Found ${validEpisodes.length} valid episodes`);
    
    if (validEpisodes.length > 0) {
      const targetSeason = seasonNum || 1;
      const targetEpisode = episodeNum || 1;
      
      const episodeData = findEpisode(validEpisodes, targetSeason, targetEpisode);
      
      if (episodeData) {
        targetContentId = episodeData.id;
        episodeTitle = episodeData.t || title;
        console.log(`[NetMirror-PrimeVideo] Found episode ID: ${targetContentId} for S${targetSeason}E${targetEpisode}`);
      } else {
        console.log(`[NetMirror-PrimeVideo] Episode S${targetSeason}E${targetEpisode} not found`);
        // Fallback to first episode of the season
        const firstEpisode = findFirstEpisode(validEpisodes, targetSeason);
        if (firstEpisode) {
          targetContentId = firstEpisode.id;
          episodeNum = firstEpisode.ep ? parseInt(firstEpisode.ep.replace("E", "")) : 1;
          console.log(`[NetMirror-PrimeVideo] Using first episode ID: ${targetContentId} for season ${targetSeason}`);
        }
      }
    }
  }
  
  return getStreamingLinks(targetContentId, episodeTitle).then(function(streamData) {
    if (!streamData.sources || streamData.sources.length === 0) {
      console.log("[NetMirror-PrimeVideo] No streaming links found");
      return [];
    }
    
    const streams = streamData.sources.map((source) => {
      let quality = extractQuality(source);
      
      let streamTitle = `${title} ${year ? `(${year})` : ""} ${quality}`;
      if (mediaType === "tv") {
        streamTitle += ` S${seasonNum || 1}E${episodeNum || 1}`;
      }
      
      return {
        name: `NetMirror (PrimeVideo)`,
        title: streamTitle,
        url: source.url,
        quality,
        type: source.type.includes("mpegURL") ? "hls" : "direct",
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13)",
          "Accept": "*/*",
          "Referer": "https://net51.cc/"
        }
      };
    });
    
    // Sort by quality (highest first)
    streams.sort(sortByQuality);
    
    console.log(`[NetMirror-PrimeVideo] Successfully processed ${streams.length} streams`);
    return streams;
  });
}

// Helper: Try multiple search strategies
function trySearchStrategies(strategies, index) {
  if (index >= strategies.length) {
    return Promise.resolve([]);
  }
  
  const searchQuery = strategies[index];
  console.log(`[NetMirror-PrimeVideo] Search strategy ${index + 1}/${strategies.length}: "${searchQuery}"`);
  
  return searchContent(searchQuery).then(function(searchResults) {
    if (searchResults.length === 0) {
      console.log(`[NetMirror-PrimeVideo] No results, trying next strategy...`);
      return trySearchStrategies(strategies, index + 1);
    }
    return searchResults;
  }).catch(function(error) {
    console.log(`[NetMirror-PrimeVideo] Error with search strategy "${searchQuery}": ${error.message}`);
    return trySearchStrategies(strategies, index + 1);
  });
}

// Helper: Get search strategies based on content type
function getSearchStrategies(title, year, mediaType, originalTitle) {
  const strategies = [];
  
  if (mediaType === "tv") {
    // For TV shows, try multiple strategies
    if (year) {
      strategies.push(`${title} ${year}`); // Title + year
      strategies.push(`${title} season 1 ${year}`); // Title + season + year
      strategies.push(`${title} s01 ${year}`); // Title + s01 + year
    }
    
    strategies.push(`${title} season 1`); // Title + season
    strategies.push(`${title} s01`); // Title + s01
    
    // Try without "The" for some shows
    if (title.startsWith("The ")) {
      const withoutThe = title.substring(4);
      strategies.push(`${withoutThe} season 1`);
      strategies.push(`${withoutThe} s01`);
    }
    
    strategies.push(title); // Just title
    
    // Try original title if different
    if (originalTitle && originalTitle.toLowerCase() !== title.toLowerCase()) {
      strategies.push(originalTitle);
      strategies.push(`${originalTitle} season 1`);
    }
  } else {
    // For movies
    if (year) {
      strategies.push(`${title} ${year}`); // Title + year
    }
    strategies.push(title); // Just title
    
    // Try original title if different
    if (originalTitle && originalTitle.toLowerCase() !== title.toLowerCase()) {
      strategies.push(originalTitle);
    }
  }
  
  return strategies;
}

// Helper: Find the most relevant search result
function findMostRelevantResult(results, query, mediaType, year) {
  if (results.length === 1) return results[0];
  
  const queryLower = query.toLowerCase();
  const isTVSearch = mediaType === "tv";
  const yearStr = year ? year.toString() : null;
  
  // Score each result
  const scoredResults = results.map(result => {
    const titleLower = result.title.toLowerCase();
    let score = 0;
    
    // Exact match bonus
    if (titleLower === queryLower) score += 100;
    
    // Contains query words
    const queryWords = queryLower.split(/\s+/);
    const titleWords = titleLower.split(/\s+/);
    const matchingWords = queryWords.filter(word => 
      titleWords.some(titleWord => titleWord.includes(word))
    );
    score += matchingWords.length * 10;
    
    // TV series indicators
    if (isTVSearch) {
      const tvIndicators = ["season", "s01", "s1", "series", "tv"];
      if (tvIndicators.some(indicator => titleLower.includes(indicator))) {
        score += 30;
      }
    }
    
    // Year match bonus
    if (yearStr && titleLower.includes(yearStr)) {
      score += 25;
    }
    
    // Movie indicators (penalize for TV searches)
    if (isTVSearch) {
      const movieIndicators = ["movie", "film"];
      if (movieIndicators.some(indicator => titleLower.includes(indicator))) {
        score -= 50;
      }
    }
    
    // The Boys specific handling
    if (queryLower.includes("boys") && isTVSearch) {
      if (titleLower.includes("movie") || titleLower.includes("film")) {
        score -= 100; // Heavy penalty for movie version
      }
      if (titleLower.includes("season") || titleLower.includes("s01")) {
        score += 50; // Big bonus for TV indicators
      }
    }
    
    return { result, score };
  });
  
  // Sort by score
  scoredResults.sort((a, b) => b.score - a.score);
  
  // Log the top results
  console.log("[NetMirror-PrimeVideo] Search result scores:");
  scoredResults.slice(0, 5).forEach((item, i) => {
    console.log(`  ${i + 1}. "${item.result.title}" - Score: ${item.score}`);
  });
  
  return scoredResults[0].result;
}

// Helper function to find episode by season and episode number
function findEpisode(episodes, season, episode) {
  return episodes.find((ep) => {
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
      return false;
    }
    
    return epSeason === season && epNumber === episode;
  });
}

// Helper function to find first episode of a season
function findFirstEpisode(episodes, season) {
  const seasonEpisodes = episodes.filter(ep => {
    let epSeason;
    
    if (ep.s) {
      epSeason = parseInt(ep.s.replace("S", ""));
    } else if (ep.season) {
      epSeason = parseInt(ep.season);
    } else if (ep.season_number) {
      epSeason = parseInt(ep.season_number);
    } else {
      return false;
    }
    
    return epSeason === season;
  });
  
  if (seasonEpisodes.length === 0) return null;
  
  // Find episode with lowest episode number
  return seasonEpisodes.reduce((first, current) => {
    let currentNum, firstNum;
    
    if (current.ep) {
      currentNum = parseInt(current.ep.replace("E", ""));
    } else if (current.episode) {
      currentNum = parseInt(current.episode);
    } else if (current.episode_number) {
      currentNum = parseInt(current.episode_number);
    } else {
      return first;
    }
    
    if (!first) return current;
    
    if (first.ep) {
      firstNum = parseInt(first.ep.replace("E", ""));
    } else if (first.episode) {
      firstNum = parseInt(first.episode);
    } else if (first.episode_number) {
      firstNum = parseInt(first.episode_number);
    }
    
    return currentNum < firstNum ? current : first;
  }, null);
}

// Helper function to extract quality from source
function extractQuality(source) {
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
      } else if (normalizedQuality.includes("360")) {
        quality = "360p";
      } else if (normalizedQuality.includes("240")) {
        quality = "240p";
      }
    }
  } else if (source.url.includes("1080p")) {
    quality = "1080p";
  } else if (source.url.includes("720p")) {
    quality = "720p";
  } else if (source.url.includes("480p")) {
    quality = "480p";
  }
  
  return quality;
}

// Helper function to sort streams by quality
function sortByQuality(a, b) {
  // "auto" quality goes first
  if (a.quality.toLowerCase() === "auto" && b.quality.toLowerCase() !== "auto") return -1;
  if (b.quality.toLowerCase() === "auto" && a.quality.toLowerCase() !== "auto") return 1;
  
  // Parse quality numbers
  const parseQuality = (quality) => {
    const match = quality.match(/(\d{3,4})p/i);
    return match ? parseInt(match[1], 10) : 0;
  };
  
  const qualityA = parseQuality(a.quality);
  const qualityB = parseQuality(b.quality);
  
  // Higher quality first
  return qualityB - qualityA;
}

// Export PrimeVideo-specific functions
if (typeof module !== "undefined" && module.exports) {
  module.exports = { 
    getStreams,
    searchContent,
    loadContent,
    getStreamingLinks,
    getEpisodesFromSeason,
    platform: PLATFORM
  };
} else {
  window.NetMirrorPrimeVideo = { 
    getStreams,
    searchContent,
    loadContent,
    getStreamingLinks,
    getEpisodesFromSeason,
    platform: PLATFORM
  };
}
