// ToonStream Provider for Nuvio (Kotlin Port v5.0)
// Exact replication of Cloudstream 'Toonstream.kt' & 'AWSStream.kt'

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

console.log('[ToonStream] ✅ Provider v5.0 Loaded');

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        /* ------------------------------------------------------------------
           STEP 1: Resolve Title via TMDB
        ------------------------------------------------------------------ */
        const tmdbResp = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const tmdbData = await tmdbResp.json();
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        // Clean title for search (remove colons, dashes for better partial matching)
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        
        console.log(`[ToonStream] Searching: "${cleanTitle}"`);

        /* ------------------------------------------------------------------
           STEP 2: Search ToonStream (Kotlin: getMainPage)
        ------------------------------------------------------------------ */
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await fetchHtml(searchUrl);
        if (!searchHtml) return [];

        // Kotlin Selector: #movies-a > ul > li
        const searchResults = parseSearch(searchHtml);
        
        // Find best match (Exact -> Fuzzy)
        const match = searchResults.find(r => r.title.toLowerCase() === title.toLowerCase()) || 
                      searchResults.find(r => r.title.toLowerCase().includes(title.toLowerCase()));

        if (!match) {
            console.log('[ToonStream] No matching title found.');
            return [];
        }

        let currentUrl = match.url;
        console.log(`[ToonStream] Found Page: ${currentUrl}`);

        /* ------------------------------------------------------------------
           STEP 3: Handle TV Series (Kotlin: load -> AJAX)
        ------------------------------------------------------------------ */
        if (mediaType === 'tv') {
            const seriesHtml = await fetchHtml(currentUrl);
            const epLink = await getTvEpisodeLink(seriesHtml, currentUrl, season, episode);
            
            if (!epLink) {
                console.log(`[ToonStream] Season ${season} Episode ${episode} not found.`);
                return [];
            }
            currentUrl = epLink;
        }

        /* ------------------------------------------------------------------
           STEP 4: Extract Links (Kotlin: loadLinks)
        ------------------------------------------------------------------ */
        console.log(`[ToonStream] Loading Player Page: ${currentUrl}`);
        const playerHtml = await fetchHtml(currentUrl);
        
        // Kotlin: document.select("#aa-options > div > iframe").attr("data-src")
        const embedUrls = extractEmbeds(playerHtml);
        const streams = [];
        const checkedHosts = new Set();

        for (const embed of embedUrls) {
            // Kotlin: val truelink = app.get(serverlink).documentLarge.selectFirst("iframe")?.attr("src")
            const realHost = await resolveRedirect(embed, currentUrl);
            
            if (realHost && !checkedHosts.has(realHost)) {
                checkedHosts.add(realHost);
                console.log(`[ToonStream] Processing Host: ${realHost}`);

                // --- EXTRACTOR 1: AWSStream / Zephyrflick (Kotlin Port) ---
                if (realHost.includes('awstream') || realHost.includes('zephyrflick')) {
                    const awsLink = await extractAWSStream(realHost);
                    if (awsLink) {
                        streams.push({
                            name: "ToonStream [Fast]",
                            type: "url",
                            url: awsLink,
                            title: "1080p (Zephyr)"
                        });
                        continue; // Success, move to next
                    }
                }

                // --- EXTRACTOR 2: Generic (VidHide/StreamWish/FileMoon) ---
                // If AWS failed or it's another host, try to find hidden m3u8
                const genericLinks = await extractGenericM3U8(realHost);
                if (genericLinks.length > 0) {
                    genericLinks.forEach(link => {
                        streams.push({
                            name: "ToonStream [HLS]",
                            type: "url",
                            url: link,
                            title: "Auto"
                        });
                    });
                } else {
                    // Fallback: Return as Embed
                    streams.push({
                        name: "ToonStream [Embed]",
                        type: "iframe",
                        url: realHost,
                        title: "External Player"
                    });
                }
            }
        }

        return streams;

    } catch (e) {
        console.error(`[ToonStream] Error: ${e.message}`);
        return [];
    }
}

// --------------------------------------------------------------------------
// HELPER FUNCTIONS
// --------------------------------------------------------------------------

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

        const res = await fetch(url, { method, headers, body });
        return res.ok ? res.text() : null;
    } catch (e) { return null; }
}

function parseSearch(html) {
    const results = [];
    const regex = /<article[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
        results.push({
            url: m[1],
            title: m[2].replace('Watch Online', '').trim()
        });
    }
    return results;
}

// Matches Kotlin: document.select("div.aa-drp.choose-season > ul > li > a")
async function getTvEpisodeLink(html, referer, season, episode) {
    // 1. Extract Data Attributes for the requested Season
    // Regex looks for: data-post="..." ... data-season="..." ... >Season X<
    const seasonRegex = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
    const match = html.match(seasonRegex);
    
    if (!match) return null;
    const [_, dataPost, dataSeason] = match;

    // 2. Perform AJAX (Kotlin: app.post("$mainUrl/wp-admin/admin-ajax.php"))
    const body = new URLSearchParams({
        'action': 'action_select_season',
        'season': dataSeason,
        'post': dataPost
    });

    const ajaxHtml = await fetchHtml(`${MAIN_URL}/wp-admin/admin-ajax.php`, referer, 'POST', body);
    if (!ajaxHtml) return null;

    // 3. Find Episode Link in Response
    // Look for: <span class="num-epi">1x1</span> ... <a href="...">
    const epRegex = /<article[\s\S]*?<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
    let em;
    while ((em = epRegex.exec(ajaxHtml)) !== null) {
        if (parseInt(em[1]) == season && parseInt(em[2]) == episode) {
            return em[3];
        }
    }
    
    return null;
}

// Matches Kotlin: document.select("#aa-options > div > iframe")
function extractEmbeds(html) {
    const urls = [];
    // Looking for data-src in iframes or generic toonstream embeds
    const regex = /(?:data-src|src)="([^"]*toonstream\.one\/home\/\?trembed=[^"]+)"/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
        urls.push(m[1].replace(/&#038;/g, '&'));
    }
    return urls;
}

// Matches Kotlin: app.get(serverlink)...selectFirst("iframe")?.attr("src")
async function resolveRedirect(url, referer) {
    const html = await fetchHtml(url, referer);
    if (!html) return null;
    
    const iframeRegex = /<iframe[^>]*src="([^"]+)"/i;
    const match = html.match(iframeRegex);
    if (match) {
        let clean = match[1];
        if (clean.startsWith('//')) clean = 'https:' + clean;
        return clean;
    }
    return null;
}

// Matches Kotlin: class AWSStream
async function extractAWSStream(url) {
    try {
        const domain = new URL(url).origin; // e.g., https://z.awstream.net
        const hash = url.split('/').pop().split('?')[0];

        // API Endpoint
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        
        // Headers & Body
        const body = new URLSearchParams();
        body.append('hash', hash);
        body.append('r', domain); // IMPORTANT: Referer must be self, not toonstream

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': USER_AGENT
            },
            body: body
        });

        const json = await res.json();
        // Kotlin: response?.videoSource
        if (json && json.videoSource && json.videoSource !== '0') {
            return json.videoSource;
        }
    } catch (e) {
        // console.log('AWS extraction failed');
    }
    return null;
}

// Matches Cloudstream Generic Extraction (GDMirrorbot etc)
async function extractGenericM3U8(url) {
    const links = [];
    try {
        const html = await fetchHtml(url);
        if (!html) return [];

        // 1. Check for packer (common in Vidhide/Streamwish)
        const packerRegex = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/;
        let content = html;
        const packed = html.match(packerRegex);
        
        // Simple unpacking if found
        if (packed) {
            // This is a naive check, but often works for finding URL strings
            // A full unpacker is too heavy, but we search the packed string for .m3u8 patterns
            content += packed[0]; 
        }

        // 2. Regex for master.m3u8 or .m3u8 links
        // Matches: https://... .m3u8
        const m3u8Regex = /(https?:\/\/[a-zA-Z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;=]+\.m3u8(?:[^\s"']*)?)/gi;
        const matches = content.match(m3u8Regex);

        if (matches) {
            matches.forEach(m => {
                if (!links.includes(m) && !m.includes('red/pixel')) links.push(m);
            });
        }
    } catch (e) {}
    return links;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
