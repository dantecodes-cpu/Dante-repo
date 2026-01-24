// ToonStream Provider for Nuvio
// Features: Native AWSStream, StreamRuby Unpacking, AJAX Season Support, Strict Cartoon Matching

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

console.log('[ToonStream] âœ… Provider Initialized');

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // ==========================================================
        // 1. TMDB LOOKUP
        // ==========================================================
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await fetchWithTimeout(tmdbUrl);
        const tmdbData = await tmdbResp.json();
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const cleanTitle = title.trim();
        const year = mediaType === 'movie' ? (tmdbData.release_date || '').split('-')[0] : (tmdbData.first_air_date || '').split('-')[0];

        console.log(`[ToonStream] Searching: "${cleanTitle}" (${year})`);

        // ==========================================================
        // 2. SEARCH TOONSTREAM
        // ==========================================================
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await fetchHtml(searchUrl);

        if (!searchHtml) return [];

        let results = [];
        const linkRegex = /href="([^"]*toonstream\.one\/(?:movies|series)\/[^"]+)"/gi;
        let match;
        
        while ((match = linkRegex.exec(searchHtml)) !== null) {
            const url = match[1];
            const slug = url.split('/').filter(Boolean).pop();
            const inferredTitle = slug.replace(/-/g, ' ');
            
            if (!results.some(r => r.url === url)) {
                results.push({ url, title: inferredTitle });
            }
        }

        // --- FILTERING: Avoid Live Action if not requested ---
        if (!cleanTitle.toLowerCase().includes('live action')) {
            const cartoonResults = results.filter(r => !r.url.includes('live-action'));
            if (cartoonResults.length > 0) {
                results = cartoonResults; // Prioritize cartoons
            }
        }

        // --- MATCHING LOGIC ---
        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(title);
        
        let matchedItem = results.find(r => normalize(r.title).includes(target)) || 
                          results.find(r => target.includes(normalize(r.title)));

        if (!matchedItem) {
            console.log(`[ToonStream] No content found for "${cleanTitle}"`);
            return [];
        }

        let contentUrl = matchedItem.url;
        console.log(`[ToonStream] Selected: ${contentUrl}`);

        // ==========================================================
        // 3. HANDLE TV EPISODES (AJAX)
        // ==========================================================
        if (mediaType === 'tv') {
            const pageHtml = await fetchHtml(contentUrl);
            
            // Regex to find Season ID
            const seasonRegex = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
            const sMatch = pageHtml.match(seasonRegex);

            if (!sMatch) {
                console.log(`[ToonStream] Season ${season} not found.`);
                return [];
            }

            // AJAX Request
            const formData = new URLSearchParams();
            formData.append('action', 'action_select_season');
            formData.append('season', sMatch[2]);
            formData.append('post', sMatch[1]);

            const ajaxHtml = await fetchHtml(`${MAIN_URL}/wp-admin/admin-ajax.php`, contentUrl, 'POST', formData);
            if (!ajaxHtml) return [];

            // Find specific episode link
            const epRegex = /<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
            let epMatch, foundEpUrl = null;
            while ((epMatch = epRegex.exec(ajaxHtml)) !== null) {
                if (parseInt(epMatch[1]) == season && parseInt(epMatch[2]) == episode) {
                    foundEpUrl = epMatch[3];
                    break;
                }
            }

            if (!foundEpUrl) {
                console.log(`[ToonStream] Episode S${season}E${episode} not found.`);
                return [];
            }
            contentUrl = foundEpUrl;
        }

        // ==========================================================
        // 4. EXTRACT PLAYERS
        // ==========================================================
        const playerHtml = await fetchHtml(contentUrl);
        
        // Find internal embeds
        const embedRegex = /(?:data-src|src)="([^"]*toonstream\.one\/home\/\?trembed=[^"]+)"/gi;
        const rawEmbeds = [];
        let em;
        while ((em = embedRegex.exec(playerHtml)) !== null) {
            rawEmbeds.push(em[1].replace(/&#038;/g, '&'));
        }
        
        console.log(`[ToonStream] Processing ${rawEmbeds.length} embeds...`);

        const streams = [];
        const processedHosts = new Set();
        
        // Sort embeds to try 0,1 first
        rawEmbeds.sort();

        // Process first 10 embeds to avoid timeouts
        for (const internalEmbed of rawEmbeds.slice(0, 10)) {
            try {
                const realHost = await resolveRedirect(internalEmbed, contentUrl);
                if (!realHost || processedHosts.has(realHost)) continue;
                processedHosts.add(realHost);

                let extracted = false;

                // A. AWSStream / Zephyrflick (Fastest)
                if (realHost.includes('awstream') || realHost.includes('zephyrflick')) {
                    const m3u8 = await extractAWSStream(realHost);
                    if (m3u8) {
                        streams.push({ name: "ToonStream [AWS]", title: "1080p (Fast)", type: "url", url: m3u8 });
                        extracted = true;
                    }
                }

                // B. StreamRuby (Remove /e/ to unpack)
                if (!extracted && realHost.includes('streamruby')) {
                    const cleanUrl = realHost.replace('/e/', '/');
                    const m3u8Links = await extractGeneric(cleanUrl);
                    if (m3u8Links.length > 0) {
                        m3u8Links.forEach(link => streams.push({ name: "ToonStream [Ruby]", title: "Auto", type: "url", url: link }));
                        extracted = true;
                    }
                }

                // C. Generic JS Packer (VidHide, StreamWish)
                if (!extracted) {
                    const m3u8Links = await extractGeneric(realHost);
                    if (m3u8Links.length > 0) {
                        m3u8Links.forEach(link => streams.push({ name: "ToonStream [HLS]", title: "Auto", type: "url", url: link }));
                        extracted = true;
                    }
                }

                // D. Fallback Iframe
                if (!extracted) {
                    const host = new URL(realHost).hostname.replace('www.', '');
                    streams.push({ 
                        name: "ToonStream [Embed]", 
                        title: host, 
                        type: "iframe", 
                        url: realHost 
                    });
                }
            } catch (innerErr) { }
        }

        return streams;

    } catch (e) {
        console.error(`[ToonStream] Error: ${e.message}`);
        return [];
    }
}

// ==========================================================
// HELPERS
// ==========================================================

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

async function fetchHtml(url, referer = MAIN_URL, method = 'GET', body = null) {
    try {
        const headers = {
            'User-Agent': USER_AGENT,
            'Referer': referer,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
        };
        if (method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            headers['X-Requested-With'] = 'XMLHttpRequest';
        }
        const res = await fetchWithTimeout(url, { method, headers, body });
        return res.ok ? res.text() : null;
    } catch (e) { return null; }
}

async function resolveRedirect(url, referer) {
    const html = await fetchHtml(url, referer);
    if (!html) return null;
    const match = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    return match ? (match[1].startsWith('//') ? 'https:' + match[1] : match[1]) : null;
}

async function extractAWSStream(url) {
    try {
        const domain = new URL(url).origin;
        const hash = url.split('/').pop().split('?')[0];
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        const body = new URLSearchParams(); body.append('hash', hash); body.append('r', domain);
        const res = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
            body: body
        });
        const json = await res.json();
        return (json && json.videoSource && json.videoSource !== '0') ? json.videoSource : null;
    } catch (e) { return null; }
}

async function extractGeneric(url) {
    try {
        const html = await fetchHtml(url);
        if (!html) return [];
        let content = html;
        const packerRegex = /(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\))/;
        const packedMatch = html.match(packerRegex);
        if (packedMatch) {
            const unpacked = unpack(packedMatch[1]);
            if (unpacked) content += unpacked;
        }
        const links = [];
        const m3u8Regex = /(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/gi;
        let m;
        while ((m = m3u8Regex.exec(content)) !== null) {
            const link = m[1].replace(/\\/g, '');
            if (!links.includes(link) && !link.includes('red/pixel')) links.push(link);
        }
        return links;
    } catch (e) { return []; }
}

function unpack(p) {
    try {
        let params = p.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/);
        if (!params) return null;
        let [_, payload, radix, count, dictionary] = params;
        dictionary = dictionary.split('|');
        radix = parseInt(radix);
        return payload.replace(/\b\w+\b/g, (w) => dictionary[parseInt(w, 36)] || w);
    } catch (e) { return null; }
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { getStreams }; }
else { global.ToonStreamProvider = { getStreams }; }
