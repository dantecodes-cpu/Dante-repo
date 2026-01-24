// ToonStream Provider for Nuvio
// NetMirror/DahmerMovies style - Returns embed URLs for Nuvio to handle

console.log('[ToonStream] Initializing provider');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const AJAX_URL = "https://toonstream.one/wp-admin/admin-ajax.php";

// Helper function for HTTP requests
function makeRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': MAIN_URL
        }
    };
    
    const requestOptions = { ...defaultOptions, ...options };
    
    return fetch(url, requestOptions)
        .then(function(response) {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.text();
        })
        .catch(function(error) {
            console.error('[ToonStream] Request failed:', url, error.message);
            throw error;
        });
}

// Get TMDB info
function getTMDBInfo(tmdbId, mediaType) {
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    console.log(`[ToonStream] Fetching TMDB info for ${tmdbId} (${mediaType})`);
    
    return fetch(url)
        .then(function(response) {
            if (!response.ok) {
                throw new Error(`TMDB HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(function(data) {
            return {
                title: mediaType === 'movie' ? data.title : data.name,
                originalTitle: mediaType === 'movie' ? data.original_title : data.original_name,
                year: mediaType === 'movie' 
                    ? (data.release_date ? data.release_date.substring(0, 4) : null)
                    : (data.first_air_date ? data.first_air_date.substring(0, 4) : null),
                overview: data.overview || ''
            };
        })
        .catch(function(error) {
            console.error('[ToonStream] TMDB error:', error);
            return null;
        });
}

// Search ToonStream
function searchContent(title, year) {
    const searchQuery = year ? `${title} ${year}` : title;
    const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(searchQuery)}`;
    
    console.log('[ToonStream] Searching for:', searchQuery);
    
    return makeRequest(searchUrl)
        .then(function(html) {
            const results = [];
            
            // Parse search results
            const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
            let articleMatch;
            
            while ((articleMatch = articleRegex.exec(html)) !== null) {
                const articleHtml = articleMatch[1];
                
                // Extract title
                const titleMatch = articleHtml.match(/<h2[^>]*>([^<]+)<\/h2>/i);
                if (!titleMatch) continue;
                
                // Extract URL
                const urlMatch = articleHtml.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
                if (!urlMatch) continue;
                
                let titleText = titleMatch[1].replace(/Watch Online/i, '').trim();
                let url = urlMatch[1];
                
                // Fix URL
                if (url.startsWith('//')) {
                    url = 'https:' + url;
                } else if (url.startsWith('/')) {
                    url = MAIN_URL + url;
                }
                
                // Determine type from URL
                const type = url.includes('/series/') ? 'tv' : 'movie';
                
                results.push({
                    title: titleText,
                    url: url,
                    type: type
                });
            }
            
            console.log(`[ToonStream] Found ${results.length} search results`);
            return results;
        })
        .catch(function(error) {
            console.error('[ToonStream] Search error:', error);
            return [];
        });
}

// Extract embed URLs from page
function extractEmbedUrls(html) {
    const embeds = [];
    
    console.log('[ToonStream] Extracting embed URLs from page');
    
    // Pattern 1: iframe with data-src (primary ToonStream pattern)
    const dataSrcRegex = /<iframe[^>]*data-src="([^"]+)"[^>]*>/gi;
    let dataSrcMatch;
    
    while ((dataSrcMatch = dataSrcRegex.exec(html)) !== null) {
        let url = dataSrcMatch[1];
        if (url.startsWith('//')) url = 'https:' + url;
        embeds.push(url);
    }
    
    // Pattern 2: iframe with src
    const srcRegex = /<iframe[^>]*src="([^"]+)"[^>]*>/gi;
    let srcMatch;
    
    while ((srcMatch = srcRegex.exec(html)) !== null) {
        let url = srcMatch[1];
        if (url.startsWith('//')) url = 'https:' + url;
        embeds.push(url);
    }
    
    // Pattern 3: div with data-src (common alternative)
    const divDataRegex = /<div[^>]*data-src="([^"]+)"[^>]*>/gi;
    let divMatch;
    
    while ((divMatch = divDataRegex.exec(html)) !== null) {
        let url = divMatch[1];
        if (url.startsWith('//')) url = 'https:' + url;
        embeds.push(url);
    }
    
    // Pattern 4: JavaScript video URLs
    const jsRegex = /video_url\s*=\s*["']([^"']+)["']/gi;
    let jsMatch;
    
    while ((jsMatch = jsRegex.exec(html)) !== null) {
        let url = jsMatch[1];
        if (url.startsWith('//')) url = 'https:' + url;
        embeds.push(url);
    }
    
    console.log(`[ToonStream] Found ${embeds.length} embed URLs`);
    return embeds;
}

// Handle TV series episode loading
function getEpisodePageUrl(html, season, episode) {
    return new Promise(function(resolve) {
        console.log(`[ToonStream] Looking for S${season}E${episode}`);
        
        // Find season selection data
        const seasonDivMatch = html.match(/<div[^>]*aa-drp[^>]*choose-season[^>]*>([\s\S]*?)<\/div>/i);
        if (!seasonDivMatch) {
            console.log('[ToonStream] No season selector found');
            resolve(null);
            return;
        }
        
        // Find the requested season
        const seasonDiv = seasonDivMatch[0];
        const seasonRegex = new RegExp(`<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s+${season}[^<]*<\/a>`, 'i');
        const seasonMatch = seasonDiv.match(seasonRegex);
        
        if (!seasonMatch) {
            console.log(`[ToonStream] Season ${season} not found`);
            resolve(null);
            return;
        }
        
        const dataPost = seasonMatch[1];
        const dataSeason = seasonMatch[2];
        
        console.log(`[ToonStream] Found season ${season} data:`, { dataPost, dataSeason });
        
        // Load season episodes via AJAX
        const formData = new URLSearchParams();
        formData.append('action', 'action_select_season');
        formData.append('season', dataSeason);
        formData.append('post', dataPost);
        
        fetch(AJAX_URL, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': MAIN_URL
            },
            body: formData.toString()
        })
        .then(function(response) {
            if (!response.ok) throw new Error(`AJAX HTTP ${response.status}`);
            return response.text();
        })
        .then(function(seasonHtml) {
            // Look for episode link
            const episodeRegex = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>.*?Episode\\s+${episode}\\b[^<]*<\/a>`, 'i');
            const episodeMatch = seasonHtml.match(episodeRegex);
            
            if (episodeMatch) {
                let episodeUrl = episodeMatch[1];
                
                // Fix URL
                if (episodeUrl.startsWith('//')) {
                    episodeUrl = 'https:' + episodeUrl;
                } else if (episodeUrl.startsWith('/')) {
                    episodeUrl = MAIN_URL + episodeUrl;
                }
                
                console.log(`[ToonStream] Found episode URL: ${episodeUrl}`);
                resolve(episodeUrl);
            } else {
                console.log(`[ToonStream] Episode ${episode} not found`);
                resolve(null);
            }
        })
        .catch(function(error) {
            console.error('[ToonStream] Episode AJAX error:', error);
            resolve(null);
        });
    });
}

// Clean AWSStream/Zephyrflick URL (extract hash correctly)
function cleanEmbedUrl(embedUrl) {
    if (!embedUrl) return '';
    
    // For AWSStream/Zephyrflick, extract hash without query params
    if (embedUrl.includes('awstream.net') || embedUrl.includes('zephyrflick.top')) {
        // Extract hash from URL like: https://z.awstream.net/embed-4/ABC123?autoplay=1
        const hashMatch = embedUrl.match(/\/([A-Za-z0-9]+)(?:\?|$)/);
        if (hashMatch && hashMatch[1]) {
            const base = embedUrl.includes('zephyrflick.top') ? 'https://play.zephyrflick.top' : 'https://z.awstream.net';
            return `${base}/embed/${hashMatch[1]}`;
        }
    }
    
    return embedUrl;
}

// Get quality from embed URL
function getQualityFromUrl(url) {
    if (!url) return 'Unknown';
    
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.includes('2160') || lowerUrl.includes('4k') || lowerUrl.includes('uhd')) return '4K';
    if (lowerUrl.includes('1440')) return '1440p';
    if (lowerUrl.includes('1080')) return '1080p';
    if (lowerUrl.includes('720')) return '720p';
    if (lowerUrl.includes('480')) return '480p';
    if (lowerUrl.includes('360')) return '360p';
    
    return 'Unknown';
}

// Main Nuvio function
function getStreams(tmdbId, mediaType, season, episode) {
    console.log(`[ToonStream] getStreams called: tmdbId=${tmdbId}, mediaType=${mediaType}, season=${season}, episode=${episode}`);
    
    let tmdbInfo = null;
    let selectedContentUrl = null;
    
    // Step 1: Get TMDB info
    return getTMDBInfo(tmdbId, mediaType)
        .then(function(info) {
            if (!info || !info.title) {
                console.error('[ToonStream] No TMDB info found');
                throw new Error('No TMDB data');
            }
            
            tmdbInfo = info;
            console.log('[ToonStream] TMDB info:', info);
            
            // Step 2: Search ToonStream
            return searchContent(info.title, info.year);
        })
        .then(function(searchResults) {
            if (searchResults.length === 0) {
                console.error('[ToonStream] No search results found');
                throw new Error('No search results');
            }
            
            // Find best matching result
            let bestMatch = searchResults[0];
            const searchTitle = tmdbInfo.title.toLowerCase();
            
            for (let i = 0; i < searchResults.length; i++) {
                const result = searchResults[i];
                const resultTitle = result.title.toLowerCase();
                
                // Prefer exact title match and correct media type
                const isExactMatch = resultTitle.includes(searchTitle) || searchTitle.includes(resultTitle);
                const isCorrectType = (mediaType === 'tv' && result.type === 'tv') || 
                                     (mediaType === 'movie' && result.type === 'movie');
                
                if (isExactMatch && isCorrectType) {
                    bestMatch = result;
                    break;
                }
            }
            
            selectedContentUrl = bestMatch.url;
            console.log('[ToonStream] Selected content:', bestMatch);
            
            // Step 3: Fetch content page
            return makeRequest(bestMatch.url);
        })
        .then(function(html) {
            if (!html) {
                throw new Error('No content HTML');
            }
            
            console.log('[ToonStream] Content page fetched');
            
            // Step 4: Handle TV series episodes
            if (mediaType === 'tv' && season && episode) {
                return getEpisodePageUrl(html, season, episode)
                    .then(function(episodeUrl) {
                        if (!episodeUrl) {
                            throw new Error('Episode not found');
                        }
                        return makeRequest(episodeUrl);
                    });
            }
            
            return html;
        })
        .then(function(html) {
            if (!html) {
                throw new Error('No episode HTML');
            }
            
            // Step 5: Extract embed URLs
            const embedUrls = extractEmbedUrls(html);
            
            if (embedUrls.length === 0) {
                console.error('[ToonStream] No embed URLs found');
                return [];
            }
            
            // Step 6: Format for Nuvio
            const streams = [];
            
            for (let i = 0; i < embedUrls.length; i++) {
                const embedUrl = cleanEmbedUrl(embedUrls[i]);
                
                if (!embedUrl || !embedUrl.startsWith('http')) {
                    continue;
                }
                
                // Build display title
                let displayTitle = tmdbInfo.title;
                if (mediaType === 'tv') {
                    if (season && episode) {
                        const s = String(season).padStart(2, '0');
                        const e = String(episode).padStart(2, '0');
                        displayTitle += ` S${s}E${e}`;
                    } else if (season) {
                        displayTitle += ` Season ${season}`;
                    }
                }
                
                if (tmdbInfo.year) {
                    displayTitle += ` (${tmdbInfo.year})`;
                }
                
                // Determine server name
                let serverName = 'ToonStream';
                if (embedUrl.includes('awstream.net')) {
                    serverName = 'AWSStream';
                } else if (embedUrl.includes('zephyrflick.top')) {
                    serverName = 'Zephyrflick';
                } else if (embedUrl.includes('streamsb.net')) {
                    serverName = 'StreamSB';
                }
                
                // Get quality
                const quality = getQualityFromUrl(embedUrl);
                
                streams.push({
                    name: serverName,
                    title: displayTitle,
                    url: embedUrl,  // CRITICAL: Return the EMBED URL, not extracted video
                    quality: quality,
                    size: 'Unknown',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': selectedContentUrl
                    },
                    subtitles: [],
                    provider: 'toonstream'
                });
            }
            
            // Remove duplicates
            const uniqueStreams = [];
            const seenUrls = new Set();
            
            for (const stream of streams) {
                if (!seenUrls.has(stream.url)) {
                    seenUrls.add(stream.url);
                    uniqueStreams.push(stream);
                }
            }
            
            // Sort by quality
            const qualityOrder = {
                '4k': 9, '2160p': 9,
                '1440p': 8,
                '1080p': 7,
                '720p': 6,
                '480p': 5,
                '360p': 4,
                'unknown': 0
            };
            
            uniqueStreams.sort(function(a, b) {
                const aQuality = a.quality.toLowerCase();
                const bQuality = b.quality.toLowerCase();
                return (qualityOrder[bQuality] || 0) - (qualityOrder[aQuality] || 0);
            });
            
            console.log(`[ToonStream] Returning ${uniqueStreams.length} streams`);
            return uniqueStreams;
        })
        .catch(function(error) {
            console.error('[ToonStream] Error in getStreams:', error.message);
            return [];
        });
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    // For React Native/Nuvio environment
    global.ToonStreamProvider = { getStreams };
}
