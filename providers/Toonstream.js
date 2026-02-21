// ToonStream Provider for Nuvio
// Version: 19.0 (CloudStream Kotlin Logic Port)
// Fixed: Path handling, Security Nonce, and Host Resolver

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // 1. GET METADATA
        const tmdbResp = await req(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const tmdbData = JSON.parse(tmdbResp);
        const title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;

        // 2. SEARCH (Handles both /home/ and root search paths)
        let searchHtml = await req(`${MAIN_URL}/home/?s=${encodeURIComponent(title)}`) || await req(`${MAIN_URL}/?s=${encodeURIComponent(title)}`);
        if (!searchHtml) return [];

        const results = [];
        // Extracting only Series or Movie links, avoiding categories
        const searchRegex = /<a href="([^"]+(?:\/series\/|\/movies\/)[^"]+)"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]+)<\/a>/gi;
        let sMatch;
        while ((sMatch = searchRegex.exec(searchHtml)) !== null) {
            results.push({ url: sMatch[1], title: sMatch[2].trim() });
        }

        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const targetTitle = normalize(title);
        let match = results.find(r => normalize(r.title) === targetTitle) || results[0];
        if (!match) return [];

        let contentUrl = match.url;

        // 3. TV EPISODE LOGIC (Uses the CloudStream AJAX/Nonce method)
        if (mediaType === 'tv') {
            const seriesHtml = await req(contentUrl);
            if (!seriesHtml) return [];

            // Extract the security nonce (standard in DooPlay themes)
            const nonce = (seriesHtml.match(/"nonce":"([^"]+)"/) || [])[1];
            const postId = (seriesHtml.match(/data-post="(\d+)"/) || seriesHtml.match(/\?p=(\d+)/) || [])[1];
            const seasonId = (seriesHtml.match(new RegExp(`data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i')) || [])[1];

            if (nonce && postId && seasonId) {
                // Mimicking the CloudStream Kotlin AJAX call
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

        // 4. EMBED EXTRACTION (Resolving 'trembed' and 'trid')
        const playerHtml = await req(contentUrl);
        const trid = (playerHtml.match(/\?p=(\d+)/) || playerHtml.match(/data-post="(\d+)"/) || [])[1];
        if (!trid) return [];

        const streams = [];
        const typeParam = mediaType === 'tv' ? '1' : '2';

        // Iterate through players (trembed 0 to 2 covers RubyStream, VidMoly, AWS)
        for (let i = 0; i < 3; i++) {
            const embedUrl = `${MAIN_URL}/home/?trembed=${i}&trid=${trid}&trtype=${typeParam}`;
            const hostHtml = await req(embedUrl, { headers: { 'Referer': contentUrl } });
            
            if (hostHtml) {
                const iframeMatch = hostHtml.match(/<iframe[^>]*src=["']([^"']+)["']/i);
                if (iframeMatch) {
                    let realUrl = iframeMatch[1];
                    if (realUrl.startsWith('//')) realUrl = 'https:' + realUrl;
                    
                    // Visit the final host and extract the M3U8
                    const links = await extractFromHost(realUrl);
                    if (links) streams.push(...links);
                }
            }
        }

        return streams;
    } catch (e) {
        return [];
    }
}

// 5. HOST EXTRACTOR (Used by all CloudStream providers)
async function extractFromHost(url) {
    const res = [];
    try {
        const domain = new URL(url).hostname.replace('www.', '').split('.')[0].toUpperCase();
        const html = await req(url, { headers: { 'Referer': MAIN_URL } });
        if (!html) return null;

        // Searches for master.m3u8 or individual qualities
        const m3u8Regex = /(https?:\/\/[^"']+\.m3u8[^"']*)/gi;
        let m;
        while ((m = m3u8Regex.exec(html)) !== null) {
            let link = m[1].replace(/\\/g, '');
            if (link.includes('google') || link.includes('advert')) continue;

            res.push({
                name: `ToonStream [${domain}]`,
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
