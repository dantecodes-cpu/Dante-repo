// ToonStream Provider for Nuvio
// Version: 21.0 (Full Kotlin Port: Search + AJAX + Extractors)

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // 1. TMDB DATA
        const tmdbResp = await req(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const tmdbData = JSON.parse(tmdbResp);
        const title = (mediaType === 'movie' ? tmdbData.title : tmdbData.name).replace(/[:\-]/g, ' ');

        // 2. SEARCH (Kotlin: search method)
        // Uses: app.get("${mainUrl}/page/$i/?s=$query")
        let searchHtml = await req(`${MAIN_URL}/page/1/?s=${encodeURIComponent(title)}`);
        if (!searchHtml) return [];

        const results = [];
        // Kotlin Selector: "#movies-a > ul > li" 
        const searchRegex = /<li[^>]*>\s*<article[^>]*>[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
        let sMatch;
        while ((sMatch = searchRegex.exec(searchHtml)) !== null) {
            results.push({ url: sMatch[1], title: sMatch[2].replace('Watch Online', '').trim() });
        }

        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const targetTitle = normalize(title);
        let match = results.find(r => normalize(r.title) === targetTitle) || results[0];
        if (!match) return [];

        let contentUrl = match.url;

        // 3. TV EPISODE LOGIC (Kotlin: load method - admin-ajax.php)
        if (mediaType === 'tv') {
            const seriesHtml = await req(contentUrl);
            const seasonRegex = /<a[^>]*data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>.*?Season\s*(\d+)\b/gi;
            let sMatch, dataPost, dataSeason;
            while ((sMatch = seasonRegex.exec(seriesHtml)) !== null) {
                if (parseInt(sMatch[3]) == season) {
                    dataPost = sMatch[1]; dataSeason = sMatch[2]; break;
                }
            }

            if (dataPost && dataSeason) {
                const ajaxHtml = await req(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                    body: `action=action_select_season&season=${dataSeason}&post=${dataPost}`
                });
                // Kotlin: season.select("article")
                const epRegex = /<article[^>]*>[\s\S]*?<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
                let epM;
                while ((epM = epRegex.exec(ajaxHtml)) !== null) {
                    if (parseInt(epM[1]) == season && parseInt(epM[2]) == episode) {
                        contentUrl = epM[3]; break;
                    }
                }
            }
        }

        // 4. LOAD LINKS (Kotlin: loadLinks method)
        const episodeHtml = await req(contentUrl);
        if (!episodeHtml) return [];

        // Selector: "#aa-options > div > iframe"
        const iframeRegex = /<iframe[^>]*data-src="([^"]+)"/gi;
        let iframeMatch;
        const streams = [];

        while ((iframeMatch = iframeRegex.exec(episodeHtml)) !== null) {
            const serverLink = iframeMatch[1];
            // Get the server page and find the final player iframe
            const serverHtml = await req(serverLink, { headers: { 'Referer': contentUrl } });
            const finalIframe = serverHtml?.match(/<iframe[^>]*src=["']([^"']+)["']/i);
            
            if (finalIframe) {
                let trueLink = finalIframe[1];
                if (trueLink.startsWith('//')) trueLink = 'https:' + trueLink;
                
                // 5. RUN EXTRACTORS (AWS, Vidmoly, StreamWish, VidHide)
                const hostLinks = await extractAll(trueLink);
                if (hostLinks) streams.push(...hostLinks);
            }
        }

        return streams;
    } catch (e) { return []; }
}

async function extractAll(url) {
    const res = [];
    const html = await req(url, { headers: { 'Referer': MAIN_URL } });
    if (!html) return null;

    // A. VIDMOLY / VIDHIDE / STREAMWISH (Packed Unpacker Logic)
    let content = html;
    if (html.includes('eval(function(p,a,c,k,e,d)')) {
        const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
        if (packed) content = unpack(packed[0]) || html;
    }

    // B. AWSSTREAM / ZEPHYRFLICK (POST method from Kotlin)
    if (url.includes('awstream') || url.includes('zephyrflick')) {
        const hash = url.split('/').pop();
        const jsonText = await req(`${new URL(url).origin}/player/index.php?data=${hash}&do=getVideo`, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `hash=${hash}&r=${encodeURIComponent(new URL(url).origin)}`
        });
        const json = JSON.parse(jsonText);
        if (json?.videoSource) res.push({ name: "AWS", title: "1080p", type: "url", url: json.videoSource });
    }

    // C. UNIVERSAL M3U8 (Matches all .m3u8 URLs found after unpacking)
    const m3u8Regex = /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
    let m;
    while ((m = m3u8Regex.exec(content)) !== null) {
        let link = m[1].replace(/\\/g, '');
        if (link.includes('google') || link.includes('advert')) continue;
        const host = new URL(url).hostname.replace('www.', '').split('.')[0].toUpperCase();
        res.push({
            name: `ToonStream [${host}]`,
            title: "Auto",
            type: "url",
            url: link,
            headers: { 'Referer': url, 'Origin': new URL(url).origin }
        });
    }

    return res.length > 0 ? res : null;
}

// HELPERS
async function req(url, opts = {}) {
    try {
        const response = await fetch(url, { ...opts, headers: { 'User-Agent': USER_AGENT, 'Referer': MAIN_URL, ...opts.headers } });
        return response.ok ? await response.text() : null;
    } catch (e) { return null; }
}

function unpack(p) {
    try {
        let params = p.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/);
        let [_, payload, radix, count, dict] = params;
        dict = dict.split('|');
        return payload.replace(/\b\w+\b/g, (w) => dict[parseInt(w, 36)] || w);
    } catch (e) { return null; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { getStreams };
