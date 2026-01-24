// ToonStream Provider for Nuvio (Fixed Phisher & AWS Logic)
// Version: 3.0

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const AJAX_URL = "https://toonstream.one/wp-admin/admin-ajax.php";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36";

console.log('[ToonStream] ✅ Provider loaded (v3.0)');

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // 1. Get Title from TMDB
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await fetch(tmdbUrl);
        const tmdbData = await tmdbResp.json();
        const title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const year = (tmdbData.release_date || tmdbData.first_air_date || "").split("-")[0];

        if (!title) return [];
        console.log(`[ToonStream] Searching: "${title}" (${year})`);

        // 2. Search ToonStream
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(title)}`;
        const searchHtml = await fetchHtml(searchUrl);
        if (!searchHtml) return [];

        const searchResults = parseSearch(searchHtml);
        const match = findBestMatch(searchResults, title);
        
        if (!match) {
            console.log('[ToonStream] No matching results found.');
            return [];
        }

        let targetUrl = match.url;
        console.log(`[ToonStream] Match found: ${match.title} -> ${targetUrl}`);

        // 3. TV Series: Handle Season/Episode Selection
        if (mediaType === 'tv') {
            const pageHtml = await fetchHtml(targetUrl);
            targetUrl = await getEpisodeLink(pageHtml, season, episode, targetUrl);
            if (!targetUrl) {
                console.log('[ToonStream] Episode link not found.');
                return [];
            }
        }

        // 4. Extract Links from Final Page
        console.log(`[ToonStream] Scraping player page: ${targetUrl}`);
        const playerPageHtml = await fetchHtml(targetUrl);
        
        // Find "Phisher" links (Local embeds that hide the real source)
        // Kotlin: document.select("#aa-options > div > iframe").attr("data-src")
        const phisherLinks = extractPhisherLinks(playerPageHtml);
        console.log(`[ToonStream] Found ${phisherLinks.length} embed options.`);

        const finalStreams = [];

        for (const pLink of phisherLinks) {
            // Resolve the "Phisher" link to the real Host URL
            const realHost = await resolvePhisher(pLink, targetUrl);
            if (!realHost) continue;

            console.log(`[ToonStream] Resolved Host: ${realHost}`);

            // 5. Extract based on Host Type
            if (realHost.includes('awstream') || realHost.includes('zephyrflick')) {
                const m3u8 = await extractAWSStream(realHost);
                if (m3u8) {
                    finalStreams.push({
                        name: "ToonStream [Fast]",
                        type: "url",
                        url: m3u8,
                        title: `Auto (HLS) - ${match.title}`
                    });
                }
            } else {
                // Return other hosts (StreamSB, Vidhide, etc) as generic iframes
                // Nuvio might allow iframes or have its own extractors for these
                finalStreams.push({
                    name: "ToonStream [Embed]",
                    type: "iframe",
                    url: realHost,
                    title: "External Player"
                });
            }
        }

        return finalStreams;

    } catch (e) {
        console.error('[ToonStream] Error:', e.message);
        return [];
    }
}

/* --- HELPER FUNCTIONS --- */

async function fetchHtml(url, referer = MAIN_URL) {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': referer
            }
        });
        return res.ok ? res.text() : null;
    } catch (e) {
        console.log(`[ToonStream] Fetch failed for ${url}`);
        return null;
    }
}

function parseSearch(html) {
    const results = [];
    const re = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        results.push({
            url: m[1],
            title: m[2].replace('Watch Online', '').trim()
        });
    }
    return results;
}

function findBestMatch(results, targetTitle) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = normalize(targetTitle);
    
    // Exact match preference
    const exact = results.find(r => normalize(r.title) === target);
    if (exact) return exact;

    // Fuzzy match
    return results.find(r => normalize(r.title).includes(target));
}

async function getEpisodeLink(html, season, episode, pageUrl) {
    // 1. Find the Season ID
    // Regex matches: data-post="123" ... data-season="1" ... >Season 1<
    const seasonRe = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
    const m = html.match(seasonRe);
    
    if (!m) return null;
    const [_, postId, seasonId] = m;

    // 2. AJAX Request for Episodes
    const params = new URLSearchParams();
    params.append('action', 'action_select_season');
    params.append('season', seasonId);
    params.append('post', postId);

    const res = await fetch(AJAX_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': pageUrl,
            'User-Agent': USER_AGENT
        },
        body: params.toString()
    });

    const ajaxHtml = await res.text();

    // 3. Parse specific episode
    // ToonStream format: <span class="num-epi">1x1</span> ... <a href="...">
    // We iterate all articles to find the matching numbers
    const articleRe = /<article[\s\S]*?<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
    let epMatch;
    
    while ((epMatch = articleRe.exec(ajaxHtml)) !== null) {
        const sNum = parseInt(epMatch[1]);
        const eNum = parseInt(epMatch[2]);
        if (sNum == season && eNum == episode) {
            return epMatch[3]; // Return the episode URL
        }
    }
    
    // Fallback: Try matching "Episode X" text if the 1x1 format isn't used
    const fallbackRe = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>.*?Episode\\s*0*${episode}\\b`, 'i');
    const fb = ajaxHtml.match(fallbackRe);
    return fb ? fb[1] : null;
}

function extractPhisherLinks(html) {
    const links = [];
    // Looking for iframes in the options div with data-src
    // Also matching generic toonstream embeds
    const re = /data-src="([^"]*toonstream\.one\/home\/\?trembed=[^"]+)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        links.push(m[1].replace(/&#038;/g, '&'));
    }
    return links;
}

async function resolvePhisher(url, referer) {
    const html = await fetchHtml(url, referer);
    if (!html) return null;

    // The real iframe is inside this wrapper page
    const re = /<iframe[^>]*src="([^"]+)"/i;
    const m = html.match(re);
    if (m) {
        let src = m[1];
        if (src.startsWith('//')) src = "https:" + src;
        return src;
    }
    return null;
}

async function extractAWSStream(url) {
    try {
        // url is like https://z.awstream.net/v/xxxx or similar
        const domain = new URL(url).origin; // https://z.awstream.net
        const hash = url.split('/').pop().replace(/[#?].*$/, '');

        // Kotlin AWSStream Logic:
        // url = "$mainUrl/player/index.php?data=$extractedHash&do=getVideo"
        // formdata = "hash": hash, "r": mainUrl
        
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        
        const body = new URLSearchParams();
        body.append('hash', hash);
        body.append('r', domain); // CRITICAL: This must match the provider domain, not toonstream

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': USER_AGENT
            },
            body: body.toString()
        });

        const json = await res.json();
        if (json && json.videoSource && json.videoSource !== '0') {
            return json.videoSource;
        }
    } catch (e) {
        console.log('[ToonStream] AWS Extraction Error:', e.message);
    }
    return null;
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
