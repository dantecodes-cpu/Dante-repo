// ToonStream Provider for Nuvio
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

console.log('[ToonStream] ✅ Provider Loaded');

// Required Nuvio function
async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // Step 1: Get TMDB Data
        const tmdbResp = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const tmdbData = await tmdbResp.json();
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        
        console.log(`[ToonStream] Searching: "${cleanTitle}"`);

        // Step 2: Search ToonStream
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await fetchHtml(searchUrl);
        if (!searchHtml) return [];

        // Parse search results - simplified selector
        const results = [];
        const itemRegex = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
        let match;
        
        while ((match = itemRegex.exec(searchHtml)) !== null) {
            const url = match[1];
            const itemTitle = match[2].replace('Watch Online', '').trim();
            if (!results.some(r => r.url === url)) {
                results.push({ url, title: itemTitle });
            }
        }

        // Find best match
        const searchTitle = cleanTitle.toLowerCase();
        let matchedItem = results.find(r => r.title.toLowerCase() === searchTitle) ||
                         results.find(r => r.title.toLowerCase().includes(searchTitle)) ||
                         results.find(r => searchTitle.includes(r.title.toLowerCase()));

        if (!matchedItem && results.length > 0) {
            matchedItem = results[0]; // Fallback to first result
        }

        if (!matchedItem) {
            console.log('[ToonStream] No results found');
            return [];
        }

        let contentUrl = matchedItem.url;
        console.log(`[ToonStream] Found: ${contentUrl}`);

        // Step 3: Handle TV Series
        if (mediaType === 'tv' && season && episode) {
            const seriesHtml = await fetchHtml(contentUrl);
            if (!seriesHtml) return [];

            // Find season data
            const seasonRegex = /data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\s*(\d+)/gi;
            let seasonMatch;
            let targetPost = null;
            let targetSeasonId = null;
            
            while ((seasonMatch = seasonRegex.exec(seriesHtml)) !== null) {
                if (parseInt(seasonMatch[3]) == season) {
                    targetPost = seasonMatch[1];
                    targetSeasonId = seasonMatch[2];
                    break;
                }
            }

            if (!targetPost) {
                console.log(`[ToonStream] Season ${season} not found`);
                return [];
            }

            // AJAX request for episodes
            const formData = new URLSearchParams();
            formData.append('action', 'action_select_season');
            formData.append('season', targetSeasonId);
            formData.append('post', targetPost);

            const ajaxUrl = `${MAIN_URL}/wp-admin/admin-ajax.php`;
            const ajaxHtml = await fetchHtml(ajaxUrl, contentUrl, 'POST', formData);
            
            if (!ajaxHtml) return [];

            // Find episode
            const epRegex = /<a href="([^"]+)"[^>]*>[\s\S]*?<span class="num-epi">(\d+)x(\d+)<\/span>/gi;
            let epMatch;
            let foundEpUrl = null;
            
            while ((epMatch = epRegex.exec(ajaxHtml)) !== null) {
                if (parseInt(epMatch[2]) == season && parseInt(epMatch[3]) == episode) {
                    foundEpUrl = epMatch[1];
                    break;
                }
            }

            if (!foundEpUrl) {
                console.log(`[ToonStream] Episode S${season}E${episode} not found`);
                return [];
            }
            
            contentUrl = foundEpUrl;
        }

        // Step 4: Extract players
        const playerHtml = await fetchHtml(contentUrl);
        if (!playerHtml) return [];

        // Find embeds
        const embedUrls = [];
        const embedRegex = /(?:data-src|src)="([^"]*\/home\/\?trembed=[^"]+)"/gi;
        let embedMatch;
        
        while ((embedMatch = embedRegex.exec(playerHtml)) !== null) {
            const url = embedMatch[1].replace(/&#038;/g, '&');
            if (url.includes('toonstream')) {
                embedUrls.push(url);
            }
        }

        console.log(`[ToonStream] Found ${embedUrls.length} embeds`);

        // Process embeds
        const streams = [];
        const processedUrls = new Set();

        for (const embedUrl of embedUrls.slice(0, 5)) { // Limit to 5 to avoid timeouts
            try {
                const realUrl = await resolveRedirect(embedUrl, contentUrl);
                if (!realUrl || processedUrls.has(realUrl)) continue;
                
                processedUrls.add(realUrl);
                console.log(`[ToonStream] Processing: ${realUrl}`);

                // Try AWSStream first
                if (realUrl.includes('awstream') || realUrl.includes('zephyr')) {
                    const awsLink = await extractAWSStream(realUrl);
                    if (awsLink) {
                        streams.push({
                            name: "ToonStream",
                            title: "HD",
                            url: awsLink,
                            type: "url"
                        });
                        continue;
                    }
                }

                // Try generic extraction
                const genericLinks = await extractGenericM3U8(realUrl);
                if (genericLinks.length > 0) {
                    genericLinks.forEach(link => {
                        streams.push({
                            name: "ToonStream",
                            title: "Auto",
                            url: link,
                            type: "url"
                        });
                    });
                } else {
                    // Fallback to iframe
                    streams.push({
                        name: "ToonStream",
                        title: "Embed",
                        url: realUrl,
                        type: "iframe"
                    });
                }
            } catch (err) {
                console.log(`[ToonStream] Error processing embed: ${err.message}`);
            }
        }

        console.log(`[ToonStream] Returning ${streams.length} streams`);
        return streams;

    } catch (e) {
        console.error(`[ToonStream] Fatal error: ${e.message}`);
        return [];
    }
}

// Helper Functions
async function fetchHtml(url, referer = MAIN_URL, method = 'GET', body = null) {
    try {
        const headers = {
            'User-Agent': USER_AGENT,
            'Referer': referer,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        };
        
        if (method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        }

        const options = {
            method,
            headers,
            timeout: 10000
        };
        
        if (body) {
            options.body = body;
        }

        const response = await fetch(url, options);
        return response.text();
    } catch (error) {
        console.log(`[ToonStream] Failed to fetch ${url}: ${error.message}`);
        return null;
    }
}

async function resolveRedirect(url, referer) {
    try {
        const html = await fetchHtml(url, referer);
        if (!html) return null;

        // Look for iframe
        const iframeRegex = /<iframe[^>]*src="([^"]+)"/i;
        const match = html.match(iframeRegex);
        if (match) {
            let src = match[1];
            if (src.startsWith('//')) {
                src = 'https:' + src;
            }
            return src;
        }

        // Return original if no iframe found
        return url;
    } catch (error) {
        return null;
    }
}

async function extractAWSStream(url) {
    try {
        const domain = new URL(url).origin;
        const hash = url.split('/').pop().split('?')[0];
        
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        
        const formData = new URLSearchParams();
        formData.append('hash', hash);
        formData.append('r', domain);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT
            },
            body: formData,
            timeout: 8000
        });

        const data = await response.json();
        if (data && data.videoSource && data.videoSource !== '0') {
            return data.videoSource;
        }
    } catch (error) {
        console.log(`[ToonStream] AWS extraction failed: ${error.message}`);
    }
    return null;
}

async function extractGenericM3U8(url) {
    const links = [];
    try {
        const html = await fetchHtml(url);
        if (!html) return links;

        // Look for m3u8 URLs
        const m3u8Regex = /(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/gi;
        const matches = html.match(m3u8Regex);
        
        if (matches) {
            matches.forEach(match => {
                if (!match.includes('red/pixel') && !links.includes(match)) {
                    links.push(match);
                }
            });
        }

        // Also check packed scripts
        const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let scriptMatch;
        while ((scriptMatch = scriptRegex.exec(html)) !== null) {
            const scriptContent = scriptMatch[1];
            if (scriptContent.includes('.m3u8')) {
                const scriptMatches = scriptContent.match(m3u8Regex);
                if (scriptMatches) {
                    scriptMatches.forEach(match => {
                        if (!match.includes('red/pixel') && !links.includes(match)) {
                            links.push(match);
                        }
                    });
                }
            }
        }
    } catch (error) {
        console.log(`[ToonStream] Generic extraction failed: ${error.message}`);
    }
    return links;
}

// Export for Nuvio
if (typeof module !== 'undefined') {
    module.exports = { getStreams };
} else {
    window.getStreams = getStreams;
}
