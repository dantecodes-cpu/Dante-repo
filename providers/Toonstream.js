// ToonStream Provider for Nuvio
// Version: 15.0 (Fixes No Links, Enables Multi-Audio for Zephyr/Vidstack)

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // ---------------------------------------------------------
        // 1. TMDB & SEARCH
        // ---------------------------------------------------------
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await req(tmdbUrl);
        const tmdbData = JSON.parse(tmdbResp);
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await req(searchUrl);
        if (!searchHtml) return [];

        const results = [];
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

        // ---------------------------------------------------------
        // 2. TV EPISODE LOGIC (AJAX)
        // ---------------------------------------------------------
        if (mediaType === 'tv') {
            const pageHtml = await req(contentUrl);
            const seasonRegex = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
            const sMatch = pageHtml.match(seasonRegex);

            if (sMatch) {
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
        }

        // ---------------------------------------------------------
        // 3. EXTRACT PLAYERS
        // ---------------------------------------------------------
        const playerHtml = await req(contentUrl);
        const embedRegex = /data-src="([^"]+)"/gi;
        const matches = [...playerHtml.matchAll(embedRegex)];
        
        const streams = [];
        const processedUrls = new Set();

        for (const m of matches) {
            let embedUrl = m[1].replace(/&#038;/g, '&');
            
            // Resolve Internal Redirects (Phisher Logic)
            if (embedUrl.includes('trembed=') || embedUrl.includes(MAIN_URL)) {
                 if (!embedUrl.startsWith('http')) embedUrl = MAIN_URL + embedUrl;
                 const resolved = await resolveInternalEmbed(embedUrl, contentUrl);
                 if (resolved) embedUrl = resolved;
            }

            if (!embedUrl || processedUrls.has(embedUrl)) continue;
            processedUrls.add(embedUrl);
            
            // ---------------------------------------------------------
            // 4. ROUTING & EXTRACTION
            // ---------------------------------------------------------
            
            // A. Zephyr / AWSStream (Known Multi-Audio)
            if (embedUrl.includes('awstream') || embedUrl.includes('zephyrflick')) {
                const res = await extractAWSStream(embedUrl);
                streams.push(...res);
            }
            // B. VidStack / Cloudy (Known Multi-Audio)
            else if (embedUrl.includes('cloudy') || embedUrl.includes('upns.one')) {
                const res = await extractVidStack(embedUrl, "ToonStream [Cloudy]");
                streams.push(...res);
            }
            // C. GDMirrorBot (Wrapper for other hosts)
            else if (embedUrl.includes('gdmirrorbot') || embedUrl.includes('techinmind')) {
                const res = await extractGDMirrorBot(embedUrl);
                streams.push(...res);
            }
            // D. StreamRuby
            else if (embedUrl.includes('rubystm') || embedUrl.includes('streamruby')) {
                const res = await extractStreamRuby(embedUrl);
                streams.push(...res);
            }
            // E. Universal Fallback
            else {
                 const res = await extractUniversal(embedUrl);
                 streams.push(...res);
            }
        }

        return streams;

    } catch (e) {
        console.error("[ToonStream] Error:", e);
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
    try {
        const response = await fetch(url, { ...opts, headers });
        return response.ok ? response.text() : null;
    } catch (e) { return null; }
}

async function resolveInternalEmbed(url, referer) {
    const html = await req(url, { headers: { Referer: referer } });
    if (!html) return null;
    const match = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    return match ? (match[1].startsWith('//') ? 'https:' + match[1] : match[1]) : null;
}

// ==========================================================
// EXTRACTORS
// ==========================================================

async function extractAWSStream(url) {
    try {
        const u = new URL(url);
        const domain = u.origin;
        const hash = u.pathname.split('/').pop();
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        // Exact Kotlin Body: hash={hash}&r={mainUrl}
        const body = `hash=${hash}&r=${domain}`;

        const jsonText = await req(apiUrl, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        });

        const json = JSON.parse(jsonText);
        if (json && json.videoSource && json.videoSource !== '0') {
            const name = url.includes('zephyr') ? "ToonStream [Zephyr]" : "ToonStream [AWS]";
            // Priority: Pass true to force inclusion of Master Playlist for Multi-Audio
            return await parseHLS(json.videoSource, { "Referer": "" }, name, true);
        }
    } catch (e) { }
    return [];
}

async function extractVidStack(url, name) {
    try {
        const u = new URL(url);
        const id = u.pathname.split('/').pop();
        const apiUrl = `${u.origin}/api/source/${id}`;
        
        const jsonText = await req(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `r=${encodeURIComponent(url)}&d=${u.hostname}`
        });
        
        const json = JSON.parse(jsonText);
        if (json && json.data && Array.isArray(json.data)) {
            const res = [];
            for (const item of json.data) {
                if (item.file && item.file.includes('.m3u8')) {
                    // Force master playlist for VidStack to support audio switching
                    const qualities = await parseHLS(item.file, { "Referer": url }, name, true);
                    res.push(...qualities);
                }
            }
            return res;
        }
    } catch (e) {}
    return [];
}

async function extractGDMirrorBot(url) {
    const res = [];
    try {
        const u = new URL(url);
        let host = u.origin;
        let sid = "";

        // 1. Key Logic
        if (url.includes("key=")) {
            const pageText = await req(url);
            if (!pageText) return [];

            const finalId = (pageText.match(/FinalID\s*=\s*"([^"]+)"/) || [])[1];
            const myKey = (pageText.match(/myKey\s*=\s*"([^"]+)"/) || [])[1];
            const idType = (pageText.match(/idType\s*=\s*"([^"]+)"/) || [])[1] || "imdbid";
            const baseUrlMatch = pageText.match(/let\s+baseUrl\s*=\s*"([^"]+)"/);
            
            if (baseUrlMatch) try { host = new URL(baseUrlMatch[1]).origin; } catch(e){}

            if (finalId && myKey) {
                let apiUrl = "";
                if (url.includes("/tv/")) {
                    const season = (url.match(/\/tv\/\d+\/(\d+)\//) || [])[1] || "1";
                    const episode = (url.match(/\/tv\/\d+\/\d+\/(\d+)/) || [])[1] || "1";
                    apiUrl = `${host}/myseriesapi?tmdbid=${finalId}&season=${season}&epname=${episode}&key=${myKey}`;
                } else {
                    apiUrl = `${host}/mymovieapi?${idType}=${finalId}&key=${myKey}`;
                }
                
                const apiText = await req(apiUrl);
                if (apiText) {
                    const apiJson = JSON.parse(apiText);
                    if (apiJson.data && apiJson.data.length > 0) sid = apiJson.data[0].fileslug;
                }
            }
        } 
        
        if (!sid) sid = url.split('/').pop();
        if (!sid) return [];

        const helperUrl = `${host}/embedhelper.php`;
        const jsonText = await req(helperUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `sid=${sid}`
        });

        if (!jsonText) return [];
        const data = JSON.parse(jsonText);
        
        if (!data.siteUrls || !data.mresult) return [];

        const siteUrls = data.siteUrls; 
        let mresult = {};
        if (typeof data.mresult === 'object') {
            mresult = data.mresult;
        } else {
            try { mresult = JSON.parse(atob(data.mresult)); } catch(e) {}
        }

        const friendlyNames = data.siteFriendlyNames || {};
        const keys = Object.keys(siteUrls);
        
        for (const key of keys) {
            if (mresult[key]) {
                const base = siteUrls[key].replace(/\/$/, '');
                const path = mresult[key].replace(/^\//, '');
                const fullUrl = `${base}/${path}`;
                const name = friendlyNames[key] || key;
                
                if (name === "StreamHG" || name === "EarnVids" || fullUrl.includes('vidhide')) {
                     const subRes = await extractUniversal(fullUrl, "ToonStream [VidHide]");
                     res.push(...subRes);
                } else if (name === "RpmShare" || name === "UpnShare" || name === "StreamP2p") {
                     const subRes = await extractVidStack(fullUrl, `ToonStream [${name}]`);
                     res.push(...subRes);
                } else if (fullUrl.includes('wish')) {
                     const subRes = await extractUniversal(fullUrl, "ToonStream [StreamWish]");
                     res.push(...subRes);
                } else {
                     const subRes = await extractUniversal(fullUrl, `ToonStream [${name}]`);
                     res.push(...subRes);
                }
            }
        }
    } catch (e) { console.log("GDMirror Error", e); }
    return res;
}

async function extractStreamRuby(url) {
    try {
        const cleanUrl = url.replace('/e/', '/');
        const html = await req(cleanUrl);
        const match = html.match(/file:\s*"(.*?m3u8.*?)"/);
        if (match) {
            return await parseHLS(match[1], { "Referer": "https://streamruby.com/" }, "ToonStream [Ruby]");
        }
    } catch (e) {}
    return [];
}

async function extractUniversal(url, customName = null) {
    const res = [];
    try {
        if (url.includes('awstream') || url.includes('zephyr')) return [];

        const headers = { 'Referer': url };
        const html = await req(url, { headers });
        if (!html) return [];
        
        let content = html;
        const packerRegex = /(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\))/;
        const packed = content.match(packerRegex);
        if (packed) {
            const unpacked = unpack(packed[1]);
            if (unpacked) content = unpacked;
        }

        const urlRegex = /["'](?<url>https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        let m;
        while ((m = urlRegex.exec(content)) !== null) {
            let link = m.groups.url.replace(/\\/g, '');
            if (!res.some(r => r.url === link)) {
                let name = customName || "ToonStream [HLS]";
                if (!customName) {
                    if (url.includes('dood')) name = "ToonStream [Dood]";
                    else if (url.includes('filemoon')) name = "ToonStream [FileMoon]";
                    else if (url.includes('wish')) name = "ToonStream [Wish]";
                }
                const qualities = await parseHLS(link, headers, name);
                res.push(...qualities);
            }
        }
    } catch (e) {}
    return res;
}

// ==========================================================
// CRITICAL FIX: PARSE HLS WITH FALLBACK
// ==========================================================
async function parseHLS(url, headers, sourceName, forceMaster = false) {
    const streams = [];
    let m3u8Content = null;

    try {
        m3u8Content = await req(url, { headers });
    } catch (e) {
        // Fallback if req fails (CORS, etc): Return Master URL
    }

    // If we couldn't get content, OR if we want to force Master (for Multi-Audio), add the master link
    if (!m3u8Content || forceMaster) {
        streams.push({
            name: sourceName,
            title: "Auto / Multi-Audio",
            type: "url",
            url: url,
            headers: headers
        });
        
        // If we failed to get content, stop here (we have the link, that's what matters)
        if (!m3u8Content) return streams;
    }

    if (m3u8Content.includes("#EXTM3U")) {
        // If it contains explicit audio definitions and we haven't forced master yet, return master
        if (!forceMaster && (m3u8Content.includes("TYPE=AUDIO") || m3u8Content.includes("GROUP-ID"))) {
             return [{
                name: sourceName,
                title: "Auto / Multi-Audio",
                type: "url",
                url: url,
                headers: headers
            }];
        }

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

    // If parsing produced nothing (not a master playlist or parsing failed), ensure we return at least the original link
    if (streams.length === 0) {
        streams.push({ name: sourceName, title: "Auto", type: "url", url: url, headers: headers });
    }

    // Sort: Multi-Audio/Auto at Top, then resolutions
    return streams.sort((a, b) => {
        if (a.title.includes("Multi-Audio")) return -1;
        if (b.title.includes("Multi-Audio")) return 1;
        return 0; // Keep others roughly same
    });
}

function unpack(p) {
    try {
        let params = p.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/);
        if (!params) return null;
        let [_, payload, radix, count, dict] = params;
        dict = dict.split('|');
        return payload.replace(/\b\w+\b/g, (w) => dict[parseInt(w, 36)] || w);
    } catch (e) { return null; }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamProvider = { getStreams }; 
}
