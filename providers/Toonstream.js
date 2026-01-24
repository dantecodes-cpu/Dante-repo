// ToonStream Provider for Nuvio (Termux Tested)
// Deep Scraper Version: Resolves internal player URLs to final hosts

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const AJAX_URL = "https://toonstream.one/wp-admin/admin-ajax.php";

console.log('[ToonStream] ✅ Final deep-provider loaded');

/**
 * Main Nuvio Entry Point
 */
async function getStreams(tmdbId, mediaType, season, episode) {
    console.log(`[ToonStream] Request: TMDB ${tmdbId} | ${mediaType} | S${season}E${episode}`);

    try {
        // 1. Get Title from TMDB
        const tmdbResp = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const tmdbData = await tmdbResp.json();
        const title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const year = (tmdbData.release_date || tmdbData.first_air_date || "").split("-")[0];

        if (!title) return [];
        console.log(`[ToonStream] Searching for: "${title}" (${year})`);

        // 2. Search ToonStream (Using Cloudstream's Working Endpoint)
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(title)}`;
        const searchHtml = await fetchHtml(searchUrl);
        if (!searchHtml) return [];

        const results = parseSearchResults(searchHtml, title);
        if (results.length === 0) {
            console.log('[ToonStream] No search results found.');
            return [];
        }

        // 3. Select Best Match and Navigate to Content Page
        let targetUrl = results[0].url;
        console.log(`[ToonStream] Selected: ${results[0].title}`);

        // 4. Handle TV Episodes via AJAX
        if (mediaType === 'tv' && season && episode) {
            const contentHtml = await fetchHtml(targetUrl);
            const epUrl = await getEpisodeUrlViaAjax(contentHtml, season, episode, targetUrl);
            if (epUrl) targetUrl = epUrl;
        }

        // 5. Fetch Final Page (Movie or Episode)
        const finalPageHtml = await fetchHtml(targetUrl);
        if (!finalPageHtml) return [];

        // 6. DEEP EXTRACTION: Follow internal player links to find real hosts
        const internalEmbeds = extractInternalPlayerLinks(finalPageHtml);
        console.log(`[ToonStream] Found ${internalEmbeds.length} internal players. Deep searching...`);

        const finalStreams = [];
        for (const embed of internalEmbeds) {
            const realHostUrl = await resolveInternalPlayer(embed, targetUrl);
            if (realHostUrl) {
                finalStreams.push(formatStream(realHostUrl, title, year, season, episode));
            }
        }

        // 7. Fallback: Search for direct m3u8 in the page
        const directLinks = finalPageHtml.match(/(https?:\/\/[^\s"'<>]+(?:\.m3u8|\.mp4))/gi) || [];
        for (const link of directLinks) {
            if (!link.includes('youtube')) {
                finalStreams.push(formatStream(link, title, year, season, episode));
            }
        }

        console.log(`[ToonStream] ✅ Total working streams: ${finalStreams.length}`);
        return deduplicate(finalStreams);

    } catch (e) {
        console.error('[ToonStream] Error:', e.message);
        return [];
    }
}

/* --- LOGIC HELPERS --- */

async function fetchHtml(url, referer = MAIN_URL) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': referer }
    });
    return res.ok ? res.text() : null;
}

function parseSearchResults(html, targetTitle) {
    const results = [];
    const re = /<article[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
    let m;
    const normalizedTarget = targetTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

    while ((m = re.exec(html)) !== null) {
        const title = m[2].replace('Watch Online', '').trim();
        const normalizedFound = title.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedFound.includes(normalizedTarget) || normalizedTarget.includes(normalizedFound)) {
            results.push({ url: m[1], title });
        }
    }
    return results;
}

async function getEpisodeUrlViaAjax(html, season, episode, pageUrl) {
    const seasonRe = new RegExp(`<a[^>]*data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s+${season}\\b`, 'i');
    const m = html.match(seasonRe);
    if (!m) return null;

    const body = new URLSearchParams({
        action: 'action_select_season_server',
        season: m[2],
        post: m[1]
    });

    const res = await fetch(AJAX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'Referer': pageUrl },
        body: body.toString()
    });

    const ajaxHtml = await res.text();
    const epRe = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>.*?Episode\\s+${episode}\\b`, 'i');
    const epM = ajaxHtml.match(epRe);
    return epM ? epM[1] : null;
}

function extractInternalPlayerLinks(html) {
    const links = [];
    const re = /<(?:iframe|div)[^>]*(?:data-src|src)="([^"]*toonstream\.one\/home\/\?trembed=[^"]+)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        links.push(m[1].replace(/&#038;/g, '&'));
    }
    return links;
}

async function resolveInternalPlayer(embedUrl, referer) {
    const html = await fetchHtml(embedUrl, referer);
    if (!html) return null;

    // Search for AWSStream, Zephyrflick, StreamSB, or Filemoon
    const re = /<iframe[^>]*src="([^"]*(?:awstream|zephyrflick|streamsb|filemoon|voe|dood)[^"]*)"/i;
    const m = html.match(re);
    if (m) return m[1].startsWith('//') ? 'https:' + m[1] : m[1];
    
    // Check for JS Sources
    const jsRe = /sources:\s*\[{file:\s*"([^"]+)"/i;
    const jsM = html.match(jsRe);
    return jsM ? jsM[1] : null;
}

function formatStream(url, title, year, s, e) {
    let quality = '720p';
    if (url.includes('1080')) quality = '1080p';
    
    let server = 'ToonStream';
    if (url.includes('awstream')) server = 'AWS';
    if (url.includes('zephyr')) server = 'Zephyr';
    if (url.includes('streamsb')) server = 'StreamSB';

    return {
        name: server,
        title: `${title}${s ? ` S${s}E${e}` : ''} (${year})`,
        url: url,
        type: "iframe", // CRITICAL FOR NUVIO
        quality: quality,
        provider: "toonstream"
    };
}

function deduplicate(streams) {
    const seen = new Set();
    return streams.filter(s => {
        const id = s.url.split('?')[0];
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

// Nuvio Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
