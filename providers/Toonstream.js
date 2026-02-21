// ToonStream Provider for Nuvio
// Version: 20.0
// Fixes: per-article HTML parsing (Ben 10 classic vs spinoffs), CDN m3u8 multi-audio, dedup

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.dad";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // ---------------------------------------------------------
        // 1. TMDB metadata
        // ---------------------------------------------------------
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await req(tmdbUrl);
        const tmdbData = JSON.parse(tmdbResp);

        const title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const year  = parseInt(
            (mediaType === 'movie' ? tmdbData.release_date : tmdbData.first_air_date || '').substring(0, 4)
        ) || 0;
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

        // ---------------------------------------------------------
        // 2. Search toonstream
        // ---------------------------------------------------------
        const searchUrl  = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await req(searchUrl);
        if (!searchHtml) return [];

        // Split on <article â€¦> so each chunk belongs to exactly one article.
        // Then extract the FIRST <a href> and the FIRST <h2> text from that chunk.
        // This prevents cross-article href/title mismatches from greedy regexes.
        const articleChunks = searchHtml.split(/<article[\s\S]*?>/i).slice(1);
        const results = [];

        for (const chunk of articleChunks) {
            // First <a href="â€¦"> in the chunk â€” the main article link
            const hrefMatch  = chunk.match(/<a\s+href="([^"]+)"/i);
            // First <h2 â€¦>â€¦</h2> in the chunk â€” the article title
            const titleMatch = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
            if (!hrefMatch || !titleMatch) continue;

            let rawUrl   = hrefMatch[1];
            let rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').replace(/Watch Online/gi, '').trim();

            if (!rawUrl.startsWith('http')) rawUrl = MAIN_URL + rawUrl;

            // Skip pagination, search, homepage
            if (!rawUrl.includes(MAIN_URL) ||
                rawUrl === MAIN_URL ||
                rawUrl === MAIN_URL + '/' ||
                rawUrl.includes('/?s=') ||
                /\/page\/\d+/.test(rawUrl)) continue;

            results.push({ url: rawUrl, title: rawTitle });
        }

        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target    = normalize(title);
        const slugTarget = cleanTitle.toLowerCase().replace(/\s+/g, '-');

        // Helper: get year from a toonstream result URL or its chunk year if available
        // We use URL slug as a proxy for exact title match instead

        // STEP 1 â€” Exact normalized title
        let selected = results.find(r => normalize(r.title) === target);

        // STEP 2 â€” Exact URL slug segment match (e.g. /series/ben-10/ NOT /series/ben-10-alien-force/)
        if (!selected) {
            selected = results.find(r => {
                try {
                    // Split path into segments, check for exact equality
                    const segs = new URL(r.url).pathname.replace(/\/$/, '').split('/');
                    return segs.includes(slugTarget);
                } catch(e) { return false; }
            });
        }

        // STEP 3 â€” If we still have multiple candidates, prefer the one whose TMDB year
        //           is closest to the toonstream result. We extract year from the chunk HTML.
        //           Since we don't have the year in results[], fall back to: if year > 0,
        //           prefer results whose title normalized == target (already done),
        //           or whose URL slug is the SHORTEST (closest to bare title).
        if (!selected && year > 0) {
            const bySlugLen = results
                .filter(r => normalize(r.title).startsWith(target))
                .sort((a, b) => {
                    try {
                        const aSlug = new URL(a.url).pathname.replace(/\/$/, '').split('/').pop();
                        const bSlug = new URL(b.url).pathname.replace(/\/$/, '').split('/').pop();
                        return aSlug.length - bSlug.length; // shortest slug = least-qualified = base title
                    } catch(e) { return 0; }
                });
            if (bySlugLen.length > 0) selected = bySlugLen[0];
        }

        // STEP 4 â€” startsWith with tight tolerance
        if (!selected) {
            selected = results.find(r => {
                const rn = normalize(r.title);
                return rn.startsWith(target) && rn.length - target.length <= 4;
            });
        }

        // STEP 5 â€” Best-effort first result
        if (!selected && results.length > 0) selected = results[0];

        if (!selected) return [];
        let contentUrl = selected.url;

        // ---------------------------------------------------------
        // 2. TV EPISODE LOGIC (AJAX) â€” mirrors Kotlin exactly
        // ---------------------------------------------------------
        if (mediaType === 'tv') {
            const pageHtml = await req(contentUrl);
            if (!pageHtml) return [];

            // FIX 2: More robust season matching â€” find all season tabs, then match by number
            // The Kotlin iterates all <a> with data-post & data-season, we do the same
            const seasonTabRegex = /data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)(?=data-post=|<\/ul>)/gi;
            let postId = null, seasonId = null;

            // Find the tab whose inner text contains the correct season number
            let tabMatch;
            while ((tabMatch = seasonTabRegex.exec(pageHtml)) !== null) {
                const innerText = tabMatch[3].replace(/<[^>]+>/g, '').trim();
                // Match "Season N" or just the number N
                const numMatch = innerText.match(/(\d+)/);
                if (numMatch && parseInt(numMatch[1]) === parseInt(season)) {
                    postId = tabMatch[1];
                    seasonId = tabMatch[2];
                    break;
                }
            }

            // Fallback: if only one season exists, just grab the first tab
            if (!postId) {
                const singleTab = pageHtml.match(/data-post="(\d+)"[^>]*data-season="(\d+)"/);
                if (singleTab) {
                    postId = singleTab[1];
                    seasonId = singleTab[2];
                }
            }

            if (!postId || !seasonId) return [];

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

            if (!ajaxHtml) return [];

            // FIX 3: More robust episode regex â€” handles single digits and variable whitespace
            // Format on site: <span class="num-epi">1x01</span> or similar
            const epRegex = /<span[^>]*class="num-epi"[^>]*>(\d+)x(\d+)<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi;
            let epMatch, foundEpUrl = null;
            while ((epMatch = epRegex.exec(ajaxHtml)) !== null) {
                if (parseInt(epMatch[1]) === parseInt(season) && parseInt(epMatch[2]) === parseInt(episode)) {
                    foundEpUrl = epMatch[3];
                    break;
                }
            }

            // Fallback: try to find by episode order if span format doesn't match
            if (!foundEpUrl) {
                const allEpLinks = [...ajaxHtml.matchAll(/<article[\s\S]*?<a\s+href="([^"]+)"/gi)];
                if (allEpLinks[episode - 1]) {
                    foundEpUrl = allEpLinks[episode - 1][1];
                }
            }

            if (!foundEpUrl) return [];
            contentUrl = foundEpUrl;
        }

        // ---------------------------------------------------------
        // 3. EXTRACT PLAYERS â€” mirrors Kotlin's loadLinks exactly
        // ---------------------------------------------------------
        const playerHtml = await req(contentUrl);
        if (!playerHtml) return [];

        // FIX 4: Use the EXACT same selector as Kotlin: #aa-options > div > iframe[data-src]
        // Then for each data-src, fetch it and find the child iframe src inside
        const playerIframeRegex = /<div[^>]*id="aa-options"[^>]*>[\s\S]*?<\/div>/i;
        const aaOptionsBlock = playerHtml.match(playerIframeRegex)?.[0] || playerHtml;

        // Collect all data-src values from iframes within #aa-options
        const dataSrcRegex = /<iframe[^>]+data-src="([^"]+)"[^>]*>/gi;
        const serverLinks = [];
        let dsMatch;
        // Search in the aa-options block first, then fall back to full page
        const searchTarget = aaOptionsBlock.includes('data-src') ? aaOptionsBlock : playerHtml;
        while ((dsMatch = dataSrcRegex.exec(searchTarget)) !== null) {
            let link = dsMatch[1].replace(/&#038;/g, '&');
            if (!link.startsWith('http')) link = 'https:' + link;
            serverLinks.push(link);
        }

        const streams = [];
        const processedUrls = new Set();

        for (const serverLink of serverLinks) {
            if (processedUrls.has(serverLink)) continue;
            processedUrls.add(serverLink);

            // FIX 5: ALWAYS resolve the server link to get the true embed URL
            // (Kotlin: val truelink = app.get(serverlink).documentLarge.selectFirst("iframe")?.attr("src"))
            let embedUrl = await resolveInternalEmbed(serverLink, contentUrl);
            if (!embedUrl) {
                // If no child iframe found, the serverLink itself might be the direct embed
                embedUrl = serverLink;
            }

            if (!embedUrl || processedUrls.has(embedUrl)) continue;
            processedUrls.add(embedUrl);

            // ---------------------------------------------------------
            // 4. ROUTING & EXTRACTION
            // ---------------------------------------------------------
            if (embedUrl.includes('awstream') || embedUrl.includes('zephyrflick') || embedUrl.includes('zephyr')) {
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
            else if (embedUrl.includes('embturbovid') || embedUrl.includes('emturbovid')) {
                const res = await extractEmturbovid(embedUrl, "ToonStream [Emturbo]");
                streams.push(...res);
            }
            else if (embedUrl.includes('vidmoly')) {
                const res = await extractVidmoly(embedUrl, "ToonStream [Vidmoly]");
                streams.push(...res);
            }
            else {
                const res = await extractUniversal(embedUrl, null);
                streams.push(...res);
            }
        }

        // Deduplicate final streams by URL â€” prevents double entries from
        // resolveInternalEmbed fallback + specific extractor both firing
        const seen = new Set();
        const dedupedStreams = streams.filter(s => {
            if (!s.url || seen.has(s.url)) return false;
            seen.add(s.url);
            return true;
        });

        return dedupedStreams;

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

// FIX 6: resolveInternalEmbed now correctly mirrors Kotlin:
// fetch the server URL, then find the first <iframe src="..."> inside it
async function resolveInternalEmbed(url, referer) {
    const html = await req(url, { headers: { 'Referer': referer } });
    if (!html) return null;
    // Try <iframe src="..."> first (what Kotlin does), then data-src
    const match = html.match(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/i);
    if (!match) return null;
    let resolved = match[1];
    if (resolved.startsWith('//')) resolved = 'https:' + resolved;
    // Don't return relative paths or anchors
    if (!resolved.startsWith('http')) return null;
    return resolved;
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
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': domain
            },
            body: body
        });

        const json = JSON.parse(jsonText);
        if (json && json.videoSource && json.videoSource !== '0') {
            const name = url.includes('zephyr') ? "ToonStream [Zephyr]" : "ToonStream [AWS]";
            // Return the master m3u8 directly â€” do NOT expand quality levels.
            // The CDN URL (e.g. 185.237.x.x/v4/.../master.m3u8) is a master playlist
            // with multi-audio; let the player handle it with no referer needed.
            return [{
                name: name,
                title: "Auto / Multi-Audio",
                type: "url",
                url: json.videoSource,
                headers: {}
            }];
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

// FIX 7: Dedicated Emturbovid extractor (mirrors Kotlin EmturbovidExtractor)
async function extractEmturbovid(url, name) {
    try {
        const html = await req(url, { headers: { 'Referer': url + '/' } });
        if (!html) return [];
        // Matches: var urlPlay = 'https://...m3u8'
        const m3u8Match = html.match(/var\s+urlPlay\s*=\s*['"]([^'"]+)['"]/);
        if (m3u8Match && m3u8Match[1]) {
            return await parseHLS(m3u8Match[1], { 'Referer': url + '/' }, name || "ToonStream [Emturbo]", true);
        }
    } catch (e) {}
    return [];
}

// Dedicated Vidmoly extractor â€” returns master playlist directly for multi-audio support
async function extractVidmoly(url, name) {
    try {
        // Vidmoly embed URLs come in several forms:
        //   https://vidmoly.to/embed-XXXXXXXX.html
        //   https://vidmoly.to/w/XXXXXXXX
        //   https://vidmoly.me/embed-XXXXXXXX.html
        // Normalise to /embed-ID.html
        let embedUrl = url;
        const vidId = url.match(/\/(?:embed-|w\/)([a-zA-Z0-9]+)/)?.[1];
        if (vidId) {
            const origin = new URL(url).origin;
            embedUrl = `${origin}/embed-${vidId}.html`;
        }

        const headers = {
            'Referer': new URL(url).origin + '/',
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate'
        };
        const html = await req(embedUrl, { headers });
        if (!html) return [];

        let content = html;
        // Unpack P.A.C.K.E.R if present
        let packedCount = 0;
        while (packedCount < 3) {
            const packed = content.match(/(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\))/);
            if (!packed) break;
            const up = unpack(packed[1]);
            if (!up || up === content) break;
            content = up;
            packedCount++;
        }

        // Match any m3u8 URL â€” catches both IP-based CDN and hostname CDN patterns:
        //   https://185.237.106.12/v4/.../master.m3u8?...
        //   https://as-cdn21.top/cdn/hls/.../master.m3u8?...
        const m3u8Match = content.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*?)["'`]/);
        if (m3u8Match) {
            return [{
                name: name || "ToonStream [Vidmoly]",
                title: "Auto / Multi-Audio",
                type: "url",
                url: m3u8Match[1],
                headers: { 'Referer': new URL(url).origin + '/' }
            }];
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
                const friendlyName = friendlyNames[key] || key;

                if (friendlyName === "RpmShare" || friendlyName === "UpnShare" || friendlyName === "StreamP2p") {
                    const subRes = await extractVidStack(fullUrl, `ToonStream [${friendlyName}]`);
                    res.push(...subRes);
                } else if (friendlyName === "StreamHG" || friendlyName === "EarnVids") {
                    // VidHidePro-style
                    const subRes = await extractUniversal(fullUrl, `ToonStream [${friendlyName}]`);
                    res.push(...subRes);
                } else {
                    const subRes = await extractUniversal(fullUrl, `ToonStream [${friendlyName}]`);
                    res.push(...subRes);
                }
            }
        }
    } catch (e) { console.log("[ToonStream] GDMirror Error", e); }
    return res;
}

// ==========================================================
// UNIVERSAL EXTRACTOR
// ==========================================================
async function extractUniversal(url, customName = null) {
    const res = [];
    try {
        // Skip domains that have dedicated extractors â€” they'd produce duplicates
        const dedicated = ['awstream', 'zephyrflick', 'zephyr', 'emturbovid', 'embturbovid',
                           'gdmirrorbot', 'techinmind', 'upns.one', 'cloudy', 'vidmoly'];
        if (dedicated.some(d => url.includes(d))) return [];

        const headers = { 'Referer': url };
        const html = await req(url, { headers });
        if (!html) return [];

        let content = html;

        // RECURSIVE UNPACKER (handles FileMoon, Premilkyway double-packing)
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

        // UNIVERSAL M3U8 REGEX
        const urlRegex = /["'](?<url>https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
        let m;
        while ((m = urlRegex.exec(content)) !== null) {
            let link = m.groups.url.replace(/\\/g, '');

            if (link.includes('red/pixel') || link.includes('error')) continue;

            if (!res.some(r => r.url === link)) {
                let name = customName || "ToonStream [HLS]";

                if (!customName) {
                    if (url.includes('rubystm') || url.includes('streamruby') || link.match(/\d+\.\d+\.\d+\.\d+/)) name = "ToonStream [Ruby]";
                    else if (url.includes('dood') || url.includes('d000d')) name = "ToonStream [Dood]";
                    else if (url.includes('filemoon') || url.includes('premilkyway')) name = "ToonStream [FileMoon]";
                    else if (url.includes('wish')) name = "ToonStream [Wish]";
                    else if (url.includes('vidhide') || url.includes('vidhidepro') || url.includes('filelions')) name = "ToonStream [VidHide]";
                }

                const qualities = await parseHLS(link, headers, name, true);
                res.push(...qualities);
            }
        }
    } catch (e) {}
    return res;
}

// ==========================================================
// M3U8 PARSER
// ==========================================================
async function parseHLS(url, headers, sourceName, forceMaster = false) {
    const streams = [];

    // When forceMaster is true, return ONLY the master playlist URL.
    // Do NOT fetch and parse it â€” that would yield individual quality tracks
    // which fail because they need the master's session/headers to resolve.
    // Zephyr, Vidmoly, AWSStream etc. all benefit from this: the player
    // receives the master m3u8 directly and handles multi-audio itself.
    if (forceMaster) {
        return [{
            name: sourceName,
            title: "Auto / Multi-Audio",
            type: "url",
            url: url,
            headers: headers
        }];
    }

    let m3u8Content = null;
    try { m3u8Content = await req(url, { headers }); } catch (e) {}

    if (!m3u8Content) {
        return [{ name: sourceName, title: "Auto", type: "url", url: url, headers: headers }];
    }

    if (m3u8Content.includes("#EXTM3U")) {
        // Master playlist with audio groups â€” hand it directly to the player
        if (m3u8Content.includes("TYPE=AUDIO") || m3u8Content.includes("GROUP-ID")) {
            return [{ name: sourceName, title: "Auto / Multi-Audio", type: "url", url: url, headers: headers }];
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

    if (streams.length === 0) {
        streams.push({ name: sourceName, title: "Auto", type: "url", url: url, headers: headers });
    }

    return streams;
}

// ==========================================================
// P.A.C.K.E.R. UNPACKER
// ==========================================================
function unpack(p) {
    try {
        let params = p.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/);
        if (!params) return null;
        let [_, payload, radix, count, dict] = params;
        dict = dict.split('|');
        radix = parseInt(radix);
        return payload.replace(/\b\w+\b/g, (w) => {
            const idx = parseInt(w, radix);
            return (dict[idx] && dict[idx] !== '') ? dict[idx] : w;
        });
    } catch (e) { return null; }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.ToonStreamProvider = { getStreams };
}
