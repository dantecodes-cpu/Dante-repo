// ToonStream Provider for Nuvio
// Based on Cloudstream Kotlin Port (v5.0) & Successful Debug Logs
// Features: Native AWSStream support + JS Packer for StreamRuby/Vidhide

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

console.log('[ToonStream] ✅ Provider Initialized');

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // ==========================================================
        // 1. TMDB LOOKUP (Get Clean Title)
        // ==========================================================
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await fetch(tmdbUrl);
        const tmdbData = await tmdbResp.json();
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        const year = mediaType === 'movie' ? (tmdbData.release_date || '').split('-')[0] : (tmdbData.first_air_date || '').split('-')[0];

        console.log(`[ToonStream] Searching: "${cleanTitle}" (${year})`);

        // ==========================================================
        // 2. SEARCH TOONSTREAM
        // ==========================================================
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await fetchHtml(searchUrl);
        if (!searchHtml) return [];

        // Parse results: #movies-a > ul > li
        const results = [];
        const regex = /<article[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
        let m;
        while ((m = regex.exec(searchHtml)) !== null) {
            results.push({ url: m[1], title: m[2].replace('Watch Online', '').trim() });
        }

        // Fuzzy Match
        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(title);
        
        const match = results.find(r => normalize(r.title) === target) || 
                      results.find(r => normalize(r.title).includes(target));

        if (!match) {
            console.log('[ToonStream] No content found');
            return [];
        }

        let contentUrl = match.url;
        console.log(`[ToonStream] Found Content: ${contentUrl}`);

        // ==========================================================
        // 3. HANDLE TV EPISODES (AJAX)
        // ==========================================================
        if (mediaType === 'tv') {
            const pageHtml = await fetchHtml(contentUrl);
            const seasonRegex = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
            const sMatch = pageHtml.match(seasonRegex);

            if (!sMatch) {
                console.log(`[ToonStream] Season ${season} not found`);
                return [];
            }

            // AJAX Request to get episodes
            const formData = new URLSearchParams();
            formData.append('action', 'action_select_season'); // Note: Kotlin uses this, debug showed it works
            formData.append('season', sMatch[2]);
            formData.append('post', sMatch[1]);

            const ajaxHtml = await fetchHtml(`${MAIN_URL}/wp-admin/admin-ajax.php`, contentUrl, 'POST', formData);
            if (!ajaxHtml) return [];

            // Find Episode Link
            // Pattern: <span class="num-epi">1x1</span> ... <a href="URL">
            const epRegex = /<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
            let epMatch, foundEpUrl = null;
            
            while ((epMatch = epRegex.exec(ajaxHtml)) !== null) {
                if (parseInt(epMatch[1]) == season && parseInt(epMatch[2]) == episode) {
                    foundEpUrl = epMatch[3];
                    break;
                }
            }

            if (!foundEpUrl) {
                console.log(`[ToonStream] Episode ${episode} not found`);
                return [];
            }
            contentUrl = foundEpUrl;
        }

        // ==========================================================
        // 4. EXTRACT EMBEDS & RESOLVE HOSTS
        // ==========================================================
        console.log(`[ToonStream] Scraping Player: ${contentUrl}`);
        const playerHtml = await fetchHtml(contentUrl);
        
        // Find internal embeds: https://toonstream.one/home/?trembed=...
        const embedRegex = /(?:data-src|src)="([^"]*toonstream\.one\/home\/\?trembed=[^"]+)"/gi;
        const rawEmbeds = [];
        let em;
        while ((em = embedRegex.exec(playerHtml)) !== null) {
            rawEmbeds.push(em[1].replace(/&#038;/g, '&'));
        }

        const streams = [];
        const processedHosts = new Set();

        for (const internalEmbed of rawEmbeds) {
            // Resolve to real host (e.g., rubystm.com, awstream.net)
            const realHost = await resolveRedirect(internalEmbed, contentUrl);
            if (!realHost || processedHosts.has(realHost)) continue;
            processedHosts.add(realHost);

            console.log(`[ToonStream] Processing: ${realHost}`);
            let extracted = false;

            // --- A. AWSStream / Zephyrflick (API) ---
            if (realHost.includes('awstream') || realHost.includes('zephyrflick')) {
                const m3u8 = await extractAWSStream(realHost);
                if (m3u8) {
                    streams.push({
                        name: "ToonStream [AWS]",
                        title: "1080p (Fast)",
                        type: "url",
                        url: m3u8
                    });
                    extracted = true;
                }
            }

            // --- B. StreamRuby / Vidhide / StreamWish (JS Packer) ---
            if (!extracted) {
                const m3u8Links = await extractWithPacker(realHost);
                if (m3u8Links.length > 0) {
                    m3u8Links.forEach(link => {
                        streams.push({
                            name: "ToonStream [HLS]",
                            title: "Auto Quality",
                            type: "url",
                            url: link
                        });
                    });
                    extracted = true;
                }
            }

            // --- C. Fallback: Iframe (Nuvio handles host) ---
            // If we couldn't extract direct link, pass it to Nuvio
            if (!extracted) {
                streams.push({
                    name: "ToonStream [Embed]",
                    title: new URL(realHost).hostname,
                    type: "iframe",
                    url: realHost
                });
            }
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

async function fetchHtml(url, referer = MAIN_URL, method = 'GET', body = null) {
    try {
        const headers = { 
            'User-Agent': USER_AGENT, 
            'Referer': referer 
        };
        if (method === 'POST') {
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            headers['X-Requested-With'] = 'XMLHttpRequest';
        }
        const res = await fetch(url, { method, headers, body });
        return res.ok ? res.text() : null;
    } catch (e) { return null; }
}

async function resolveRedirect(url, referer) {
    const html = await fetchHtml(url, referer);
    if (!html) return null;
    const match = html.match(/<iframe[^>]*src="([^"]+)"/i);
    return match ? (match[1].startsWith('//') ? 'https:' + match[1] : match[1]) : null;
}

// AWSStream Logic from Kotlin
async function extractAWSStream(url) {
    try {
        const domain = new URL(url).origin;
        const hash = url.split('/').pop().split('?')[0];
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        
        const body = new URLSearchParams();
        body.append('hash', hash);
        body.append('r', domain);

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT
            },
            body: body
        });
        const json = await res.json();
        return (json && json.videoSource && json.videoSource !== '0') ? json.videoSource : null;
    } catch (e) { return null; }
}

// Generic JS Packer Unpacker & M3U8 Finder
async function extractWithPacker(url) {
    try {
        const html = await fetchHtml(url);
        if (!html) return [];
        let content = html;

        // 1. Detect Packer
        const packerRegex = /(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\))/;
        const packedMatch = html.match(packerRegex);
        
        if (packedMatch) {
            const unpacked = unpack(packedMatch[1]);
            if (unpacked) content += unpacked;
        }

        // 2. Find M3U8
        // Regex looks for "file": "url" or just http...m3u8
        const links = [];
        const m3u8Regex = /(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/gi;
        let m;
        while ((m = m3u8Regex.exec(content)) !== null) {
            const link = m[1].replace(/\\/g, ''); // Remove escape slashes
            if (!links.includes(link)) links.push(link);
        }
        return links;
    } catch (e) { return []; }
}

// Dean Edwards Packer Unpacker (Lightweight)
function unpack(p) {
    try {
        let params = p.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/);
        if (!params) return null;
        
        let [_, payload, radix, count, dictionary] = params;
        dictionary = dictionary.split('|');
        radix = parseInt(radix);
        
        const decode = (c) => {
            return (c < radix ? '' : decode(parseInt(c / radix))) + 
                   ((c = c % radix) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
        };

        // Replace logic
        return payload.replace(/\b\w+\b/g, (w) => {
            const v = parseInt(w, 36);
            return dictionary[v] || w;
        });
    } catch (e) { return null; }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamProvider = { getStreams };
}
