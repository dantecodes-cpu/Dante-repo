// ToonStream Provider for Nuvio
// Version: 22.0 (Feb 2024 Fix - Domain & Player Chain Update)
// Features: Phisher's CloudStream Logic + User's Quality Parser

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad"; // Updated Domain
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // 1. TMDB & SEARCH (Phisher Logic: #movies-a > ul > li)
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await req(tmdbUrl);
        const tmdbData = JSON.parse(tmdbResp);
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await req(searchUrl);
        if (!searchHtml) return [];

        const results = [];
        // Match <li> containing the search result structure
        const searchRegex = /<li[^>]*>\s*<article[^>]*>[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
        let sMatch;
        while ((sMatch = searchRegex.exec(searchHtml)) !== null) {
            results.push({ 
                url: sMatch[1], 
                title: sMatch[2].replace('Watch Online', '').trim() 
            });
        }

        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(title);
        let match = results.find(r => normalize(r.title) === target) || results[0];

        if (!match) return [];
        let contentUrl = match.url;

        // 2. TV EPISODE LOGIC (Phisher AJAX Logic)
        if (mediaType === 'tv') {
            const seriesHtml = await req(contentUrl);
            const seasonLinkRegex = /<a[^>]*data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>.*?Season\s*(\d+)\b/gi;
            let seasonMatch, dataPost, dataSeason;
            
            while ((seasonMatch = seasonLinkRegex.exec(seriesHtml)) !== null) {
                if (parseInt(seasonMatch[3]) == season) {
                    dataPost = seasonMatch[1];
                    dataSeason = seasonMatch[2];
                    break;
                }
            }

            if (!dataPost || !dataSeason) return [];

            const ajaxHtml = await req(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest' 
                },
                body: `action=action_select_season&season=${dataSeason}&post=${dataPost}`
            });

            const epRegex = /<article[^>]*>[\s\S]*?<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
            let epMatch, foundEpUrl = null;
            while ((epMatch = epRegex.exec(ajaxHtml)) !== null) {
                if (parseInt(epMatch[1]) == season && parseInt(epMatch[2]) == episode) {
                    foundEpUrl = epMatch[3];
                    break;
                }
            }
            if (!foundEpUrl) return [];
            contentUrl = foundEpUrl;
        }

        // 3. EXTRACT PLAYERS (Double-Jump Chain)
        const episodeHtml = await req(contentUrl);
        // Step A: Find the "trembed" links in #aa-options
        const iframeRegex = /<iframe[^>]*data-src="([^"]+)"/gi;
        let iframeMatch;
        const streams = [];

        while ((iframeMatch = iframeRegex.exec(episodeHtml)) !== null) {
            try {
                const trembedUrl = iframeMatch[1];
                // Step B: Fetch trembed page to find final host iframe (CloudStream loadLinks logic)
                const trembedHtml = await req(trembedUrl, { headers: { 'Referer': contentUrl } });
                const hostIframeMatch = trembedHtml?.match(/<iframe[^>]*src=["']([^"']+)["']/i);
                
                if (hostIframeMatch) {
                    let realUrl = hostIframeMatch[1];
                    if (realUrl.startsWith('//')) realUrl = 'https:' + realUrl;
                    
                    // Step C: Run Extractors
                    const extracted = await runExtractors(realUrl);
                    if (extracted) streams.push(...extracted);
                }
            } catch (err) { }
        }

        return streams;

    } catch (e) {
        return [];
    }
}

// ==========================================================
// EXTRACTORS & HELPERS
// ==========================================================

async function runExtractors(url) {
    const res = [];
    const headers = { 'Referer': url, 'Origin': new URL(url).origin };
    let hostName = new URL(url).hostname.replace('www.','').split('.')[0].toUpperCase();

    // 1. AWSStream / Zephyr (POST method from Phisher's repo)
    if (url.includes('awstream') || url.includes('zephyrflick')) {
        const hash = url.split('/').pop();
        const api = `${new URL(url).origin}/player/index.php?data=${hash}&do=getVideo`;
        const jsonText = await req(api, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `hash=${hash}&r=${encodeURIComponent(new URL(url).origin)}`
        });
        const json = JSON.parse(jsonText);
        if (json?.videoSource) {
            return await parseHLS(json.videoSource, {}, `ToonStream [${hostName}]`);
        }
    }

    // 2. Generic / Packed (Vidmoly, StreamWish, VidHide, etc.)
    const html = await req(url, { headers });
    let content = html;
    if (html.includes('eval(function(p,a,c,k,e,d)')) {
        const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
        if (packed) content = unpack(packed[0]) || html;
    }

    const m3u8Regex = /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
    let m;
    while ((m = m3u8Regex.exec(content)) !== null) {
        let link = m[1].replace(/\\/g, '');
        if (link.includes('google') || link.includes('advert')) continue;
        const qualities = await parseHLS(link, headers, `ToonStream [${hostName}]`);
        res.push(...qualities);
    }
    return res;
}

async function parseHLS(url, headers, sourceName) {
    const streams = [];
    try {
        const m3u8Content = await req(url, { headers });
        if (!m3u8Content) return [];
        const lines = m3u8Content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('RESOLUTION=')) {
                const resMatch = lines[i].match(/RESOLUTION=\d+x(\d+)/);
                let quality = resMatch ? resMatch[1] + "p" : "Auto";
                let nextLine = lines[i + 1]?.trim();
                if (nextLine && !nextLine.startsWith('#')) {
                    let sUrl = nextLine.startsWith('http') ? nextLine : url.substring(0, url.lastIndexOf('/') + 1) + nextLine;
                    streams.push({ name: sourceName, title: quality, type: "url", url: sUrl, headers });
                }
            }
        }
    } catch (e) { }
    if (streams.length === 0) streams.push({ name: sourceName, title: "Auto", type: "url", url, headers });
    return streams.sort((a,b) => parseInt(b.title) - parseInt(a.title));
}

async function req(url, opts = {}) {
    const headers = { 'User-Agent': USER_AGENT, 'Referer': MAIN_URL, ...opts.headers };
    const response = await fetch(url, { ...opts, headers });
    return response.ok ? response.text() : null;
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
