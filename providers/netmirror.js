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
    
    // Cloudstream's static user token
    const cloudstreamToken = "a0a5f663894ade410614071fe46baca6";
    
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
          
          // Create quality variants like Cloudstream does
          const qualities = ["1080p", "720p", "480p", "360p", "Auto"];
          
          qualities.forEach(quality => {
            let variantUrl = fullUrl;
            
            // For Auto quality, keep original URL (no q parameter)
            if (quality !== "Auto") {
              // Parse URL to add or replace q parameter
              const urlParts = variantUrl.split('?');
              const basePath = urlParts[0];
              const queryString = urlParts[1] || '';
              
              // Parse query parameters
              const params = new URLSearchParams(queryString);
              
              // Remove existing q/quality parameters
              params.delete('q');
              params.delete('quality');
              
              // Add the new q parameter FIRST
              const newParams = new URLSearchParams();
              newParams.append('q', quality);
              
              // Copy all other parameters
              for (const [key, value] of params.entries()) {
                newParams.append(key, value);
              }
              
              // Rebuild URL with q parameter first
              variantUrl = `${basePath}?${newParams.toString()}`;
            }
            
            // Ensure URL has proper in= parameter format
            if (variantUrl.includes('in=')) {
              // Fix the in= parameter to use Cloudstream's token
              const inMatch = variantUrl.match(/in=([^&]+)/);
              if (inMatch) {
                const inParts = inMatch[1].split('::');
                if (inParts.length >= 4) {
                  // Replace first part with Cloudstream's token
                  inParts[0] = cloudstreamToken;
                  // Update timestamp
                  inParts[2] = getUnixTime().toString();
                  const newInParam = inParts.join('::');
                  variantUrl = variantUrl.replace(/in=[^&]+/, `in=${newInParam}`);
                }
              }
            }
            
            sources.push({
              url: variantUrl,
              quality: quality,
              type: source.type || "application/x-mpegURL"
            });
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
    
    // Debug: Show first few URLs
    if (sources.length > 0) {
      console.log(`[NetMirror] Sample URLs for ${platform}:`);
      const qualitySamples = {};
      sources.forEach(source => {
        if (!qualitySamples[source.quality]) {
          qualitySamples[source.quality] = source.url.substring(0, 120) + '...';
        }
      });
      
      Object.entries(qualitySamples).forEach(([quality, url]) => {
        console.log(`  ${quality}: ${url}`);
      });
    }
    
    return { sources, subtitles };
  });
}

// Helper function for getStreams to parse quality from URL
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
                // Quality is already set in getStreamingLinks
                const quality = source.quality;
                
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
              
              // Sort by quality (1080p first, then 720p, etc.)
              streams.sort((a, b) => {
                if (a.quality === "Auto" && b.quality !== "Auto") return 1;
                if (b.quality === "Auto" && a.quality !== "Auto") return -1;
                
                const qualityOrder = ["1080p", "720p", "480p", "360p", "Auto"];
                return qualityOrder.indexOf(a.quality) - qualityOrder.indexOf(b.quality);
              });
              
              console.log(`[NetMirror] Successfully processed ${streams.length} streams from ${platform}`);
              console.log(`[NetMirror] Available qualities: ${[...new Set(streams.map(s => s.quality))].join(', ')}`);
              
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
