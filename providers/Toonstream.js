// ToonStream Provider for Nuvio
// Version: 17.0 (Universal Extractor + Recursive Unpacker)
// Reference: Phisher98 Commit 0e6df7b

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
        const embedRegex = /(?:data-src|src)="([^"]+)"/gi;
        const matches = [...playerHtml.matchAll(embedRegex)];
        
        const streams = [];
        const processedUrls = new Set();

        for (const m of matches) {
            let embedUrl = m[1].replace(/&#038;/g, '&');
            
            // Resolve Internal Embeds (Trembed/Phisher Logic)
            if (embedUrl.includes('trembed=') || embedUrl.includes(MAIN_URL)) {
                 if (!embedUrl.startsWith('http')) embedUrl = MAIN_URL + embedUrl;
                 const resolved = await resolveInternalEmbed(embedUrl, contentUrl);
                 if (resolved) embedUrl = resolved;
            }

            if (!embedUrl || processedUrls.has(embedUrl)) continue;
            processedUrls.add(embedUrl);

            // ---------------------------------------------------------
            // 4. ROUTING & UNIVERSAL EXTRACTION
            // ---------------------------------------------------------

            // A. Specific High-Quality Extractors
            if (embedUrl.includes('awstream') || embedUrl.includes('zephyrflick')) {
                const res = await extractAWSStream(embedUrl);
                streams.push(...res);
            }
            else if (embedUrl.includes('gdmirrorbot') || embedUrl.includes('techinmind')) {
                const res = await extractGDMirrorBot(embedUrl);
                streams.push(...res);
            }
            else if (embedUrl.includes('cloudy') || embedUrl.includes('upns.one')) {
                const res = await extractVidStack(embedUrl, "ToonStream [Cloudy]");
                streams.push(...res);
            }
            else if (embedUrl.includes('embturbovid') || embedUrl.includes('emturbovid')) { // Added based on commit
                 const res = await extractUniversal(embedUrl, "ToonStream [Emturbo]");
                 streams.push(...res);
            }
            // B. Universal Fallback (Catches StreamRuby IPs, FileMoon, etc.)
            else {
                 // Pass "null" as name to let auto-detection work
                 const res = await extractUniversal(embedUrl, null);
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
// SPECIFIC EXTRACTORS
// ==========================================================

async function extractAWSStream(url) {
    try {
        const u = new URL(url);
        const domain = u.origin;
        const hash = u.pathname.split('/').pop();
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        const body = `hash=${hash}&r=${domain}`;

        const jsonText = await req(apiUrl, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        });

        const json = JSON.parse(jsonText);
        if (json && json.videoSource && json.videoSource !== '0') {
            const name = url.includes('zephyr') ? "ToonStream [Zephyr]" : "ToonStream [AWS]";
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
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': url,
                'Origin': u.origin
            },
            body: `r=${encodeURIComponent(url)}&d=${u.hostname}`
        });
        
        const json = JSON.parse(jsonText);
        if (json && json.data && Array.isArray(json.data)) {
            const res = [];
            for (const item of json.data) {
                // Matches .m3u8 AND standard types (catches strmupcdn)
                if (item.file && (item.file.includes('.m3u8') || item.type === 'hls' || item.type === 'application/x-mpegURL')) {
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
                
                if (name === "RpmShare" || name === "UpnShare" || name === "StreamP2p") {
                     const subRes = await extractVidStack(fullUrl, `ToonStream [${name}]`);
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

// ==========================================================
// UNIVERSAL EXTRACTOR (Catches StreamRuby IPs, FileMoon, etc)
// ==========================================================
async function extractUniversal(url, customName = null) {
    const res = [];
    try {
        if (url.includes('awstream') || url.includes('zephyr')) return [];

        const headers = { 'Referer': url };
        const html = await req(url, { headers });
        if (!html) return [];
        
        let content = html;
        
        // RECURSIVE UNPACKER (Fixes FileMoon/Premilkyway which double-packs code)
        let packedCount = 0;
        let hasPacked = true;
        while (hasPacked && packedCount < 5) {
            const packerRegex = /(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\))/;
            const packed = content.match(packerRegex);
            if (packed) {
                const unpacked = unpack(packed[1]);
                if (unpacked && unpacked !== content) {
                    content = unpacked;
                    packedCount++;
                } else { hasPacked = false; }
            } else { hasPacked = false; }
        }

        // UNIVERSAL M3U8 REGEX (Catches 45.x.x.x IPs, strmupcdn, premilkyway, etc.)
        const urlRegex = /["'](?<url>https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        let m;
        while ((m = urlRegex.exec(content)) !== null) {
            let link = m.groups.url.replace(/\\/g, '');
            
            // Filter out junk
            if (link.includes('red/pixel') || link.includes('error')) continue;

            if (!res.some(r => r.url === link)) {
                let name = customName || "ToonStream [HLS]";
                
                // Auto-Naming based on content
                if (!customName) {
                    if (url.includes('rubystm') || url.includes('streamruby') || link.match(/\d+\.\d+\.\d+\.\d+/)) name = "ToonStream [Ruby]";
                    else if (url.includes('dood')) name = "ToonStream [Dood]";
                    else if (url.includes('filemoon') || url.includes('premilkyway')) name = "ToonStream [FileMoon]";
                    else if (url.includes('wish')) name = "ToonStream [Wish]";
                }
                
                const qualities = await parseHLS(link, headers, name, true);
                res.push(...qualities);
            }
        }
    } catch (e) {}
    return res;
}

// ==========================================================
// M3U8 PARSER (Forces Master Playlist for Multi-Audio)
// ==========================================================
async function parseHLS(url, headers, sourceName, forceMaster = false) {
    const streams = [];
    let m3u8Content = null;

    try { m3u8Content = await req(url, { headers }); } catch (e) {}

    // Fallback: Return raw link if fetch failed (Network issue) or forced
    if (!m3u8Content || forceMaster) {
        streams.push({
            name: sourceName,
            title: "Auto / Multi-Audio",
            type: "url",
            url: url,
            headers: headers
        });
        if (!m3u8Content) return streams;
    }

    if (m3u8Content.includes("#EXTM3U")) {
        // Force Master if Audio Tracks Detected
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
    
    // Ensure at least one stream exists
    if (streams.length === 0) {
        streams.push({ name: sourceName, title: "Auto", type: "url", url: url, headers: headers });
    }

    // Sort: Multi-Audio First
    return streams.sort((a, b) => {
        if (a.title.includes("Multi-Audio")) return -1;
        if (b.title.includes("Multi-Audio")) return 1;
        return 0; 
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
