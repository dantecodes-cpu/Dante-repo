// ToonStream Provider for Nuvio
// Version: 18.0 (Ported Logic from Cloudstream 3 Kotlin Provider)

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // 1. GET METADATA
        const tmdbResp = await req(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const tmdbData = JSON.parse(tmdbResp);
        const title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;

        // 2. SEARCH (Kotlin Logic: Scrape Search Results)
        const searchHtml = await req(`${MAIN_URL}/home/?s=${encodeURIComponent(title)}`);
        if (!searchHtml) return [];

        // Scrape search results (Cloudstream uses Jsoup; we use Regex)
        const results = [];
        const searchRegex = /<a href="([^"]+)"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]+)<\/a>/gi;
        let sMatch;
        while ((sMatch = searchRegex.exec(searchHtml)) !== null) {
            const url = sMatch[1];
            if (url.includes('/series/') || url.includes('/movies/')) {
                results.push({ url, title: sMatch[2].trim() });
            }
        }

        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const targetTitle = normalize(title);
        let match = results.find(r => normalize(r.title) === targetTitle) || results[0];
        if (!match) return [];

        let contentUrl = match.url;

        // 3. TV SHOW LOGIC (The "Cloudstream AJAX" Method)
        if (mediaType === 'tv') {
            const seriesHtml = await req(contentUrl);
            
            // Extract security nonce (Found in the JS variables on the page)
            const nonce = (seriesHtml.match(/"nonce":"([^"]+)"/) || [])[1];
            const postId = (seriesHtml.match(/data-post="(\d+)"/) || seriesHtml.match(/\?p=(\d+)/) || [])[1];
            const seasonId = (seriesHtml.match(new RegExp(`data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i')) || [])[1];

            if (nonce && postId && seasonId) {
                // Construct the exact AJAX call Cloudstream uses
                const ajaxHtml = await req(`${MAIN_URL}/home/wp-admin/admin-ajax.php`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest' 
                    },
                    body: `action=action_select_season&season=${seasonId}&post=${postId}&nonce=${nonce}`
                });

                if (ajaxHtml) {
                    const epRegex = new RegExp(`<span class="num-epi">${season}x${episode}<\\/span>[\\s\\S]*?<a href="([^"]+)"`, 'i');
                    const epMatch = ajaxHtml.match(epRegex);
                    if (epMatch) contentUrl = epMatch[1];
                }
            }
        }

        // 4. EMBED EXTRACTION (The "trembed" Loop)
        const playerHtml = await req(contentUrl);
        const trid = (playerHtml.match(/\?p=(\d+)/) || playerHtml.match(/data-post="(\d+)"/) || [])[1];
        if (!trid) return [];

        const streams = [];
        const types = mediaType === 'tv' ? '1' : '2';

        // Cloudstream iterates through the players available on the site
        // trembed=0 (usually RubyStream), 1 (VidMoly), 2 (AWS/StreamWish)
        for (let i = 0; i <= 3; i++) {
            const embedUrl = `${MAIN_URL}/home/?trembed=${i}&trid=${trid}&trtype=${types}`;
            const embedHtml = await req(embedUrl, { headers: { 'Referer': contentUrl } });
            
            if (embedHtml) {
                const iframeMatch = embedHtml.match(/<iframe[^>]*src=["']([^"']+)["']/i);
                if (iframeMatch) {
                    let realUrl = iframeMatch[1];
                    if (realUrl.startsWith('//')) realUrl = 'https:' + realUrl;
                    
                    // Extract from the host
                    const hostLinks = await extractLinks(realUrl);
                    if (hostLinks) streams.push(...hostLinks);
                }
            }
        }

        return streams;

    } catch (e) {
        return [];
    }
}

// Extraction Logic for Hosts found in Cloudstream Extractors
async function extractLinks(url) {
    const res = [];
    try {
        const html = await req(url, { headers: { 'Referer': MAIN_URL } });
        if (!html) return null;

        // RubyStream / StreamWish / VidMoly logic: Look for .m3u8 in eval(packed) or direct strings
        const m3u8Regex = /(https?:\/\/[^"']+\.m3u8[^"']*)/gi;
        let m;
        while ((m = m3u8Regex.exec(html)) !== null) {
            let link = m[1].replace(/\\/g, '');
            if (link.includes('google') || link.includes('advert')) continue;

            res.push({
                name: `ToonStream [${new URL(url).hostname.replace('www.','')}]`,
                title: "Auto",
                type: "url",
                url: link,
                headers: { 'Referer': url, 'Origin': new URL(url).origin }
            });
        }
    } catch (e) {}
    return res.length > 0 ? res : null;
}

async function req(url, opts = {}) {
    try {
        const response = await fetch(url, { 
            ...opts, 
            headers: { 
                'User-Agent': USER_AGENT, 
                'Referer': MAIN_URL,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...opts.headers 
            } 
        });
        return response.ok ? await response.text() : null;
    } catch (e) { return null; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { getStreams };
