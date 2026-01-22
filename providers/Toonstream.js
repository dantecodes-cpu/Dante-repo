// toonstream.nuvio.js

const TOONSTREAM_BASE = "https://toonstream.one";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";

const AJAX_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': TOONSTREAM_BASE + '/'
};

// Cache for better performance
let cache = {
    tmdb: {},
    search: {},
    content: {},
    streams: {}
};

// ================= TMDB API FUNCTIONS =================

async function fetchTMDBDetails(tmdbId, mediaType) {
    const cacheKey = `tmdb:${tmdbId}:${mediaType}`;
    
    if (cache.tmdb[cacheKey]) {
        return cache.tmdb[cacheKey];
    }
    
    console.log(`[Toonstream] Fetching TMDB details for ${tmdbId} (${mediaType})`);
    
    try {
        const url = `${TMDB_BASE}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`TMDB API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        const result = {
            title: mediaType === 'movie' ? data.title : data.name,
            originalTitle: data.original_title || data.original_name,
            year: mediaType === 'movie' 
                ? data.release_date?.substring(0, 4) 
                : data.first_air_date?.substring(0, 4),
            overview: data.overview,
            genres: data.genres?.map(g => g.name) || [],
            poster: data.poster_path 
                ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
                : null
        };
        
        cache.tmdb[cacheKey] = result;
        setTimeout(() => delete cache.tmdb[cacheKey], 3600000); // 1 hour cache
        
        console.log(`[Toonstream] TMDB details: "${result.title}" (${result.year})`);
        return result;
    } catch (error) {
        console.error(`[Toonstream] TMDB fetch failed:`, error.message);
        throw error;
    }
}

// ================= UTILITY FUNCTIONS =================

async function makeRequest(url, options = {}) {
    const headers = { ...AJAX_HEADERS, ...options.headers };
    
    try {
        const response = await fetch(url, {
            ...options,
            headers,
            timeout: 10000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.text();
    } catch (error) {
        console.log(`[Toonstream] Request failed: ${url}`, error.message);
        throw error;
    }
}

function parseHTML(html) {
    // In browser environment
    if (typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        return parser.parseFromString(html, 'text/html');
    }
    // In Node.js environment (for testing)
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html);
    return dom.window.document;
}

function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return TOONSTREAM_BASE + url;
    return TOONSTREAM_BASE + '/' + url;
}

// ================= EMBED EXTRACTORS =================

async function extractMegacloud(embedUrl) {
    console.log('[Toonstream] Extracting Megacloud:', embedUrl);
    
    try {
        const mainUrl = 'https://megacloud.blog';
        const headers = {
            'Accept': '*/*',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': mainUrl,
            'User-Agent': AJAX_HEADERS['User-Agent']
        };
        
        // First get the embed page
        const page = await makeRequest(embedUrl, { headers });
        if (!page) return [];
        
        // Find nonce in the page
        let nonce = page.match(/\b[a-zA-Z0-9]{48}\b/)?.[0];
        if (!nonce) {
            const m = page.match(/\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/);
            nonce = m ? m[1] + m[2] + m[3] : null;
        }
        
        if (!nonce) {
            console.log('[Toonstream] Could not find nonce in Megacloud page');
            return [];
        }
        
        const id = embedUrl.split('/').pop().split('?')[0];
        const apiUrl = `${mainUrl}/embed-2/v3/e-1/getSources?id=${id}&_k=${nonce}`;
        
        const response = await fetch(apiUrl, { headers });
        if (!response.ok) return [];
        
        const json = await response.json();
        if (!json?.sources?.length) return [];
        
        const sources = [];
        
        for (const source of json.sources) {
            let m3u8Url = source.file;
            
            // Handle encrypted sources
            if (!m3u8Url.includes('.m3u8')) {
                // Try to decode
                try {
                    const decodeUrl = 'https://script.google.com/macros/s/AKfycbxHbYHbrGMXYD2-bC-C43D3njIbU-wGiYQuJL61H4vyy6YVXkybMNNEPJNPPuZrD1gRVA/exec';
                    
                    const secretResponse = await fetch('https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json');
                    if (secretResponse.ok) {
                        const keys = await secretResponse.json();
                        const secret = keys?.mega;
                        
                        if (secret) {
                            const fullUrl = `${decodeUrl}?encrypted_data=${encodeURIComponent(m3u8Url)}&nonce=${encodeURIComponent(nonce)}&secret=${encodeURIComponent(secret)}`;
                            
                            const decodeResponse = await fetch(fullUrl);
                            if (decodeResponse.ok) {
                                const txt = await decodeResponse.text();
                                const match = txt?.match(/"file":"(.*?)"/);
                                m3u8Url = match?.[1] || m3u8Url;
                            }
                        }
                    }
                } catch (e) {
                    console.log('[Toonstream] Megacloud decode failed:', e.message);
                }
            }
            
            if (m3u8Url.includes('.m3u8')) {
                sources.push({
                    url: m3u8Url,
                    type: 'hls',
                    quality: source.label || 'HD',
                    headers: {
                        'Referer': mainUrl,
                        'User-Agent': AJAX_HEADERS['User-Agent']
                    },
                    subtitles: (json.tracks || [])
                        .filter(t => t.kind === 'captions' || t.kind === 'subtitles')
                        .map(t => ({ label: t.label, url: t.file }))
                });
            }
        }
        
        return sources;
    } catch (error) {
        console.log('[Toonstream] Megacloud extraction failed:', error.message);
        return [];
    }
}

async function extractAWSStream(embedUrl) {
    console.log('[Toonstream] Extracting AWSStream:', embedUrl);
    
    try {
        // Extract hash from URL
        const hash = embedUrl.split('/').pop().split('?')[0];
        
        const apiUrl = 'https://z.awstream.net/player/index.php?data=' + hash + '&do=getVideo';
        const headers = {
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://z.awstream.net/',
            'User-Agent': AJAX_HEADERS['User-Agent']
        };
        
        const formData = new URLSearchParams();
        formData.append('hash', hash);
        formData.append('r', 'https://z.awstream.net');
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: formData
        });
        
        if (!response.ok) return [];
        
        const data = await response.json();
        
        if (!data?.videoSource) {
            console.log('[Toonstream] No video source in AWSStream response');
            return [];
        }
        
        return [{
            url: data.videoSource,
            type: 'hls',
            quality: 'HD',
            headers: {
                'Referer': 'https://z.awstream.net/',
                'User-Agent': AJAX_HEADERS['User-Agent']
            }
        }];
    } catch (error) {
        console.log('[Toonstream] AWSStream extraction failed:', error.message);
        return [];
    }
}

async function extractGenericEmbed(embedUrl) {
    console.log('[Toonstream] Extracting generic embed:', embedUrl);
    
    const extractors = [
        { pattern: /megacloud/, func: extractMegacloud },
        { pattern: /awstream|zephyrflick/, func: extractAWSStream }
    ];
    
    for (const extractor of extractors) {
        if (extractor.pattern.test(embedUrl)) {
            return await extractor.func(embedUrl);
        }
    }
    
    // Default: try to extract m3u8 from iframe
    try {
        const page = await makeRequest(embedUrl);
        if (!page) return [];
        
        // Look for m3u8 URLs
        const m3u8Matches = page.match(/https?:\/\/[^"\s]+\.m3u8[^"\s]*/g);
        if (m3u8Matches) {
            return m3u8Matches.map(url => ({
                url: url,
                type: 'hls',
                quality: 'HD',
                headers: {
                    'Referer': embedUrl,
                    'User-Agent': AJAX_HEADERS['User-Agent']
                }
            }));
        }
    } catch (error) {
        console.log('[Toonstream] Generic extraction failed:', error.message);
    }
    
    return [];
}

// ================= TOONSTREAM SEARCH =================

async function searchToonstream(query) {
    const cacheKey = `search:${query}`;
    
    if (cache.search[cacheKey]) {
        return cache.search[cacheKey];
    }
    
    console.log(`[Toonstream] Searching Toonstream for: "${query}"`);
    
    try {
        const url = `${TOONSTREAM_BASE}/?s=${encodeURIComponent(query)}`;
        const html = await makeRequest(url);
        const doc = parseHTML(html);
        
        const results = [];
        const items = doc.querySelectorAll("#movies-a > ul > li");
        
        for (const item of items) {
            const titleElement = item.querySelector("article > header > h2");
            const linkElement = item.querySelector("article > a");
            const imageElement = item.querySelector("article > div.post-thumbnail > figure > img");
            
            if (!titleElement || !linkElement) continue;
            
            const title = titleElement.textContent.trim().replace("Watch Online", "").trim();
            const href = linkElement.getAttribute("href");
            let posterUrl = imageElement ? imageElement.getAttribute("src") : "";
            
            if (!href) continue;
            
            const itemId = href.split('/').filter(Boolean).pop();
            
            results.push({
                id: itemId,
                title: title,
                url: fixUrl(href),
                poster: fixUrl(posterUrl),
                type: href.includes('/series/') ? 'series' : 'movie'
            });
        }
        
        cache.search[cacheKey] = results;
        setTimeout(() => delete cache.search[cacheKey], 300000); // 5 minutes cache
        
        console.log(`[Toonstream] Found ${results.length} results`);
        return results;
    } catch (error) {
        console.log(`[Toonstream] Search failed:`, error.message);
        return [];
    }
}

// ================= CONTENT DETAILS =================

async function getContentDetails(contentUrl) {
    const cacheKey = `content:${contentUrl}`;
    
    if (cache.content[cacheKey]) {
        return cache.content[cacheKey];
    }
    
    console.log(`[Toonstream] Loading content: ${contentUrl}`);
    
    try {
        const html = await makeRequest(contentUrl);
        const doc = parseHTML(html);
        
        const titleElement = doc.querySelector("header.entry-header > h1");
        const posterElement = doc.querySelector("div.bghd > img");
        const descriptionElement = doc.querySelector("div.description > p");
        
        const title = titleElement ? titleElement.textContent.trim().replace("Watch Online", "").trim() : "Unknown";
        let posterUrl = posterElement ? posterElement.getAttribute("src") : "";
        const description = descriptionElement ? descriptionElement.textContent.trim() : "";
        
        const isSeries = contentUrl.includes('/series/');
        const episodes = [];
        
        if (isSeries) {
            // Extract seasons and episodes
            const seasonElements = doc.querySelectorAll("div.aa-drp.choose-season > ul > li > a");
            
            for (let seasonIndex = 0; seasonIndex < seasonElements.length; seasonIndex++) {
                const seasonElement = seasonElements[seasonIndex];
                const dataPost = seasonElement.getAttribute("data-post");
                const dataSeason = seasonElement.getAttribute("data-season");
                
                if (!dataPost || !dataSeason) continue;
                
                const formData = new URLSearchParams();
                formData.append("action", "action_select_season");
                formData.append("season", dataSeason);
                formData.append("post", dataPost);
                
                try {
                    const response = await fetch(`${TOONSTREAM_BASE}/wp-admin/admin-ajax.php`, {
                        method: "POST",
                        headers: {
                            ...AJAX_HEADERS,
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                        body: formData.toString()
                    });
                    
                    if (response.ok) {
                        const seasonHtml = await response.text();
                        const seasonDoc = parseHTML(seasonHtml);
                        const episodeElements = seasonDoc.querySelectorAll("article");
                        
                        episodeElements.forEach((episodeElement, epIndex) => {
                            const episodeLink = episodeElement.querySelector("article > a");
                            const episodeTitleElement = episodeElement.querySelector("article > header.entry-header > h2");
                            
                            if (!episodeLink) return;
                            
                            const episodeUrl = episodeLink.getAttribute("href");
                            const episodeTitle = episodeTitleElement ? 
                                episodeTitleElement.textContent.trim() : 
                                `Episode ${epIndex + 1}`;
                            
                            episodes.push({
                                id: episodeUrl.split('/').filter(Boolean).pop(),
                                title: episodeTitle,
                                url: fixUrl(episodeUrl),
                                season: seasonIndex + 1,
                                episode: epIndex + 1
                            });
                        });
                    }
                } catch (error) {
                    console.log(`[Toonstream] Error loading season ${seasonIndex + 1}:`, error.message);
                }
            }
        }
        
        const content = {
            title: title,
            poster: fixUrl(posterUrl),
            description: description,
            type: isSeries ? 'series' : 'movie',
            episodes: episodes
        };
        
        cache.content[cacheKey] = content;
        setTimeout(() => delete cache.content[cacheKey], 300000); // 5 minutes cache
        
        return content;
    } catch (error) {
        console.log(`[Toonstream] Content load failed:`, error.message);
        return null;
    }
}

// ================= STREAM EXTRACTION =================

async function extractStreamsFromPage(pageUrl) {
    const cacheKey = `streams:${pageUrl}`;
    
    if (cache.streams[cacheKey]) {
        return cache.streams[cacheKey];
    }
    
    console.log(`[Toonstream] Extracting streams from: ${pageUrl}`);
    
    try {
        const html = await makeRequest(pageUrl);
        const doc = parseHTML(html);
        
        const iframeElements = doc.querySelectorAll("#aa-options > div > iframe");
        const streams = [];
        
        // Process each iframe
        for (let i = 0; i < iframeElements.length; i++) {
            const iframe = iframeElements[i];
            const serverLink = iframe.getAttribute("data-src");
            if (!serverLink) continue;
            
            console.log(`[Toonstream] Found server link ${i + 1}: ${serverLink}`);
            
            // First, get the iframe content
            try {
                const iframeHtml = await makeRequest(serverLink);
                const iframeDoc = parseHTML(iframeHtml);
                const nestedIframe = iframeDoc.querySelector("iframe");
                
                if (nestedIframe) {
                    const embedUrl = nestedIframe.getAttribute("src");
                    if (!embedUrl) continue;
                    
                    console.log(`[Toonstream] Found embed URL: ${embedUrl}`);
                    
                    // Extract from embed
                    const embedStreams = await extractGenericEmbed(embedUrl);
                    
                    embedStreams.forEach((stream, index) => {
                        streams.push({
                            url: stream.url,
                            type: stream.type || 'hls',
                            quality: stream.quality || 'HD',
                            headers: stream.headers || {
                                'Referer': TOONSTREAM_BASE,
                                'User-Agent': AJAX_HEADERS['User-Agent']
                            },
                            subtitles: stream.subtitles || []
                        });
                    });
                }
            } catch (error) {
                console.log(`[Toonstream] Failed to process iframe ${i + 1}:`, error.message);
            }
        }
        
        cache.streams[cacheKey] = streams;
        setTimeout(() => delete cache.streams[cacheKey], 180000); // 3 minutes cache
        
        return streams;
    } catch (error) {
        console.log(`[Toonstream] Stream extraction failed:`, error.message);
        return [];
    }
}

// ================= MAIN FUNCTION =================

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    console.log(`[Toonstream] Request: TMDB ${tmdbId}, ${mediaType}, S${season}E${episode}`);
    
    try {
        // Step 1: Get title from TMDB
        const tmdbDetails = await fetchTMDBDetails(tmdbId, mediaType);
        
        if (!tmdbDetails || !tmdbDetails.title) {
            console.log('[Toonstream] No title from TMDB');
            return [];
        }
        
        // Step 2: Search on Toonstream with the title
        let searchResults = [];
        
        // Try different search queries
        const searchQueries = [
            tmdbDetails.title,
            tmdbDetails.originalTitle,
            `${tmdbDetails.title} ${mediaType === 'tv' ? 'series' : 'movie'}`,
            tmdbDetails.title.replace(/[^a-zA-Z0-9 ]/g, '')
        ];
        
        for (const query of searchQueries) {
            if (!query) continue;
            
            searchResults = await searchToonstream(query);
            if (searchResults.length > 0) {
                console.log(`[Toonstream] Found results with query: "${query}"`);
                break;
            }
        }
        
        if (searchResults.length === 0) {
            console.log('[Toonstream] No results found on Toonstream');
            return [];
        }
        
        // Step 3: Find the best matching result
        let bestMatch = searchResults[0];
        
        // Simple scoring system
        const targetTitle = tmdbDetails.title.toLowerCase();
        for (const result of searchResults) {
            const resultTitle = result.title.toLowerCase();
            
            // Exact match
            if (resultTitle === targetTitle) {
                bestMatch = result;
                break;
            }
            
            // Contains the title
            if (resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)) {
                bestMatch = result;
                break;
            }
            
            // Check if type matches
            const correctType = (mediaType === 'tv' && result.type === 'series') || 
                               (mediaType === 'movie' && result.type === 'movie');
            
            if (correctType && !bestMatch.type.match) {
                bestMatch = result;
            }
        }
        
        console.log(`[Toonstream] Selected: "${bestMatch.title}" (${bestMatch.type})`);
        
        // Step 4: Get content details
        const contentDetails = await getContentDetails(bestMatch.url);
        
        if (!contentDetails) {
            console.log('[Toonstream] Failed to get content details');
            return [];
        }
        
        // Step 5: Determine which page to extract streams from
        let streamPageUrl = bestMatch.url;
        
        if (mediaType === 'tv' && season && episode && contentDetails.episodes.length > 0) {
            // Find the specific episode
            const targetEpisode = contentDetails.episodes.find(ep => 
                ep.season === season && ep.episode === episode
            );
            
            if (targetEpisode) {
                streamPageUrl = targetEpisode.url;
                console.log(`[Toonstream] Found episode: ${targetEpisode.title} (S${season}E${episode})`);
            } else {
                console.log(`[Toonstream] Episode S${season}E${episode} not found, using series page`);
            }
        }
        
        // Step 6: Extract streams from the page
        const streams = await extractStreamsFromPage(streamPageUrl);
        
        // Step 7: Format streams for Nuvio
        const formattedStreams = streams.map((stream, index) => {
            let quality = stream.quality;
            if (!quality && stream.url.includes('1080')) quality = '1080p';
            if (!quality && stream.url.includes('720')) quality = '720p';
            if (!quality && stream.url.includes('480')) quality = '480p';
            if (!quality) quality = 'HD';
            
            let title = `${tmdbDetails.title}`;
            if (mediaType === 'tv' && season && episode) {
                title += ` S${season}E${episode}`;
            }
            title += ` (${quality})`;
            
            return {
                name: `Toonstream ${index + 1}`,
                title: title,
                url: stream.url,
                quality: quality,
                type: stream.type,
                headers: stream.headers,
                subtitles: stream.subtitles,
                provider: 'Toonstream'
            };
        });
        
        console.log(`[Toonstream] Found ${formattedStreams.length} streams`);
        return formattedStreams;
        
    } catch (error) {
        console.error(`[Toonstream] Error:`, error);
        return [];
    }
}

// ================= NUVIO PROVIDER =================

const provider = {
    manifest: {
        id: 'com.toonstream',
        version: '1.0.0',
        name: 'Toonstream',
        description: 'Watch cartoons, anime and movies from Toonstream',
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: []
    },

    getStreams: async function(args) {
        const { type, id } = args;
        
        // Extract TMDB ID and episode info
        let tmdbId = null;
        let season = null;
        let episode = null;
        
        if (id.includes(':')) {
            // Format: tt1234567:1:1 for series
            const parts = id.split(':');
            tmdbId = parts[0].replace('tt', '');
            
            if (parts.length >= 2) season = parseInt(parts[1]);
            if (parts.length >= 3) episode = parseInt(parts[2]);
        } else {
            // Simple TMDB ID
            tmdbId = id.replace('tt', '');
        }
        
        if (!tmdbId || isNaN(parseInt(tmdbId))) {
            console.log('[Toonstream] Invalid TMDB ID:', id);
            return { streams: [] };
        }
        
        const streams = await getStreams(tmdbId, type, season, episode);
        
        return {
            streams: streams.map(stream => ({
                name: stream.name,
                title: stream.title,
                url: stream.url,
                quality: stream.quality,
                type: stream.type,
                headers: stream.headers,
                subtitles: stream.subtitles,
                behaviorHints: {
                    notWebReady: false,
                    proxyHeaders: stream.headers,
                    bingeGroup: `toonstream-${id}`
                }
            }))
        };
    }
};

// ================= EXPORT =================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams, provider };
} else if (typeof define === 'function' && define.amd) {
    define([], function() { return { getStreams, provider }; });
} else if (typeof window !== 'undefined') {
    window.toonstreamProvider = provider;
    window.toonstreamGetStreams = getStreams;
}
