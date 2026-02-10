// ToonStream Provider for Nuvio
// Version: 12.0 (Sync with Kotlin)

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // 1. TMDB & SEARCH
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await req(tmdbUrl);
        const tmdbData = JSON.parse(tmdbResp);
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        // Clean title logic
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await req(searchUrl);
        if (!searchHtml) return [];

        const results = [];
        // Regex matches the Kotlin selector: #movies-a > ul > li > article
        // We look for article tags with hrefs
        const articleRegex = /<article[^>]*>[\s\S]*?<a href="([^"]+)"[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/gi;
        let match;
        while ((match = articleRegex.exec(searchHtml)) !== null) {
            let rawUrl = match[1];
            let rawTitle = match[2].replace('Watch Online', '').trim();
            
            if (!rawUrl.startsWith('http')) rawUrl = MAIN_URL + rawUrl;
            
            if (rawUrl.includes('/movies/') || rawUrl.includes('/series/') || rawUrl.includes('/cartoon/') || rawUrl.includes('/anime/')) {
                results.push({ url: rawUrl, title: rawTitle });
            }
        }

        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(title);
        
        let selected = results.find(r => normalize(r.title) === target);
        if (!selected) {
            const slugTarget = cleanTitle.toLowerCase().replace(/\s+/g, '-');
            selected = results.find(r => r.url.toLowerCase().includes(slugTarget));
        }
        if (!selected) selected = results.find(r => normalize(r.title).startsWith(target));

        if (!selected) return [];
        let contentUrl = selected.url;

        // 2. TV EPISODE LOGIC (AJAX)
        if (mediaType === 'tv') {
            const pageHtml = await req(contentUrl);
            
            // Kotlin logic: Finds data-post and data-season in: div.aa-drp.choose-season > ul > li > a
            // Then POSTs to admin-ajax.php
            const seasonRegex = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
            const sMatch = pageHtml.match(seasonRegex);

            if (!sMatch) {
                // Sometimes season 1 is default/loaded or there is only one season? 
                // If regex fails, we might already be on the page, but usually Toonstream uses AJAX for episodes.
                // Let's try to find if episodes are already listed or fallback.
                return [];
            }

            const postId = sMatch[1];
            const seasonId = sMatch[2];
            const ajaxUrl = `${MAIN_URL}/wp-admin/admin-ajax.php`;
            const formData = `action=action_select_season&season=${seasonId}&post=${postId}`;
            
            const ajaxHtml = await req(ajaxUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': contentUrl
                },
                body: formData
            });

            // Parse episodes from AJAX response
            // Kotlin: <span class="num-epi">1x1</span> ... <a href="...">
            const epRegex = /<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
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

        // 3. EXTRACT PLAYERS
        const playerHtml = await req(contentUrl);
        // Kotlin Logic: Selects #aa-options > div > iframe -> attr("data-src")
        // The data-src is usually an internal embed like: https://toonstream.dad/home/?trembed=...
        
        const embedRegex = /data-src="([^"]+)"/gi;
        const matches = [...playerHtml.matchAll(embedRegex)];
        
        const streams = [];
        const processedUrls = new Set();

        for (const m of matches) {
            let embedUrl = m[1].replace(/&#038;/g, '&');
            
            // Filter: Ensure it's a trembed link or relevant internal link
            if (!embedUrl.includes('trembed=') && !embedUrl.includes(MAIN_URL)) continue;
            if (!embedUrl.startsWith('http')) embedUrl = MAIN_URL + embedUrl;

            // Kotlin Logic: truelink = app.get(serverlink).documentLarge.selectFirst("iframe")?.attr("src")
            const realUrl = await resolveRedirect(embedUrl, contentUrl);
            
            if (!realUrl || processedUrls.has(realUrl)) continue;
            processedUrls.add(realUrl);
            
            // Extract based on host
            let extracted = false;

            // A. AWSStream / Zephyr (Kotlin: AWSStream class)
            if (realUrl.includes('awstream') || realUrl.includes('zephyrflick')) {
                const res = await extractAWSStream(realUrl);
                if (res && res.length > 0) { streams.push(...res); extracted = true; }
            }

            // B. Universal Fallback (VidStack, etc)
            if (!extracted) {
                const genericLinks = await extractUniversal(realUrl);
                if (genericLinks.length > 0) {
                    streams.push(...genericLinks);
                    extracted = true;
                }
            }
        }

        return streams;

    } catch (e) {
        console.log("Toonstream Error:", e);
        return [];
    }
}

// ==========================================================
// HELPERS
// ==========================================================

async function req(url, opts = {}) {
    const headers = { 
        'User-Agent': USER_AGENT, 
        'Referer': MAIN_URL, 
        ...opts.headers 
    };
    const response = await fetch(url, { ...opts, headers });
    return response.ok ? response.text() : null;
}

// Emulates: app.get(serverlink).documentLarge.selectFirst("iframe")?.attr("src")
async function resolveRedirect(url, referer) {
    try {
        const html = await req(url, { headers: { Referer: referer } });
        if (!html) return null;
        const match = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
        if (match) {
            let src = match[1];
            if (src.startsWith('//')) src = 'https:' + src;
            return src;
        }
        return null;
    } catch(e) { return null; }
}

async function parseHLS(url, headers, sourceName) {
    const streams = [];
    try {
        const m3u8Content = await req(url, { headers });
        if (!m3u8Content) return [];

        if (m3u8Content.includes("#EXTM3U")) {
            const lines = m3u8Content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXT-X-STREAM-INF')) {
                    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
                    let quality = "Auto";
                    if (resMatch) {
                        const height = parseInt(resMatch[2]);
                        if (height >= 1080) quality = "1080p";
                        else if (height >= 720) quality = "720p";
                        else if (height >= 480) quality = "480p";
                        else quality = "360p";
                    }

                    let nextLine = lines[i + 1]?.trim();
                    if (nextLine && !nextLine.startsWith('#')) {
                        if (!nextLine.startsWith('http')) {
                            const u = new URL(url);
                            const basePath = url.substring(0, url.lastIndexOf('/') + 1);
                            nextLine = nextLine.startsWith('/') ? u.origin + nextLine : basePath + nextLine;
                        }
                        streams.push({ name: sourceName, title: quality, type: "url", url: nextLine, headers: headers });
                    }
                }
            }
        }
    } catch (e) { }

    if (streams.length === 0) {
        streams.push({ name: sourceName, title: "Auto", type: "url", url: url, headers: headers });
    }
    return streams;
}

// Matches Kotlin: AWSStream class
async function extractAWSStream(url) {
    try {
        const domain = new URL(url).origin; // Handles z.awstream.net or play.zephyrflick.top
        const hash = url.split('/').pop().split('?')[0];
        
        // API: /player/index.php?data={hash}&do=getVideo
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        const body = `hash=${hash}&r=${domain}`; // Kotlin sends r=mainUrl, but r=domain usually works safely
        
        const jsonText = await req(apiUrl, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        });
        
        const json = JSON.parse(jsonText);
        if (json && json.videoSource && json.videoSource !== '0') {
            return await parseHLS(json.videoSource, { "Referer": "" }, "ToonStream [AWS]");
        }
    } catch (e) { return null; }
}

async function extractUniversal(url) {
    const res = [];
    try {
        const headers = { 'Referer': url };
        const html = await req(url, { headers });
        if (!html) return [];
        
        // Simple HLS regex
        const urlRegex = /["'](?<url>https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        let m;
        while ((m = urlRegex.exec(html)) !== null) {
            let link = m.groups.url;
            link = link.replace(/\\/g, '');
            if (!res.some(r => r.url === link)) {
                let name = "ToonStream [HLS]";
                if (url.includes('ruby')) name = "ToonStream [Ruby]";
                else if (url.includes('cloudy')) name = "ToonStream [Cloudy]";
                
                const qualities = await parseHLS(link, headers, name);
                res.push(...qualities);
            }
        }
    } catch (e) {}
    return res;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamProvider = { getStreams }; 
}
