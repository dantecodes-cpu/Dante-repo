// ToonStream Provider for Nuvio
// Version: 21.0 â€” Full extractor suite, robust #aa-options parsing, Courage fix

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL     = "https://toonstream.dad";
const USER_AGENT   = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  MAIN ENTRY POINT
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // 1. TMDB metadata
        const tmdbData  = JSON.parse(await req(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`));
        const title     = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const year      = parseInt((mediaType === 'movie' ? tmdbData.release_date : tmdbData.first_air_date || '').slice(0, 4)) || 0;
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();

        // 2. Search toonstream
        const searchHtml = await req(`${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`);
        if (!searchHtml) return [];

        // Split HTML on <article> tags so href/title always come from the SAME article.
        // This prevents cross-article mismatches (the root cause of Ben 10 / Alien Force issue).
        const results = [];
        for (const chunk of searchHtml.split(/<article[\s\S]*?>/i).slice(1)) {
            const hrefM  = chunk.match(/<a\s+href="([^"]+)"/i);
            const titleM = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
            if (!hrefM || !titleM) continue;
            let rawUrl   = hrefM[1].startsWith('http') ? hrefM[1] : MAIN_URL + hrefM[1];
            const rawTitle = titleM[1].replace(/<[^>]+>/g, '').replace(/Watch Online/gi, '').trim();
            if (rawUrl === MAIN_URL || rawUrl === MAIN_URL + '/' ||
                rawUrl.includes('/?s=') || /\/page\/\d+/.test(rawUrl)) continue;
            results.push({ url: rawUrl, title: rawTitle });
        }

        // 3. Match best result
        const norm       = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target     = norm(title);
        const slugTarget = cleanTitle.toLowerCase().replace(/\s+/g, '-');

        // Step 1: exact normalized title  ("ben10" === "ben10")
        let selected = results.find(r => norm(r.title) === target);

        // Step 2: exact slug path segment  ("/series/ben-10/" NOT "/series/ben-10-alien-force/")
        if (!selected) {
            selected = results.find(r => {
                try { return new URL(r.url).pathname.replace(/\/$/, '').split('/').includes(slugTarget); }
                catch(e) { return false; }
            });
        }

        // Step 3: year-based tiebreak â€” prefer the URL with the shortest slug (base title)
        if (!selected && year > 0) {
            const candidates = results.filter(r => norm(r.title).startsWith(target));
            if (candidates.length) {
                selected = candidates.sort((a, b) => {
                    try {
                        const aL = new URL(a.url).pathname.replace(/\/$/, '').split('/').pop().length;
                        const bL = new URL(b.url).pathname.replace(/\/$/, '').split('/').pop().length;
                        return aL - bL;
                    } catch(e) { return 0; }
                })[0];
            }
        }

        // Step 4: startsWith with tight tolerance (handles year suffix etc.)
        if (!selected)
            selected = results.find(r => { const rn = norm(r.title); return rn.startsWith(target) && rn.length - target.length <= 4; });

        // Step 5: best-effort first result
        if (!selected && results.length) selected = results[0];
        if (!selected) return [];

        let contentUrl = selected.url;

        // 4. TV â€” find the right episode via AJAX
        if (mediaType === 'tv') {
            const pageHtml = await req(contentUrl);
            if (!pageHtml) return [];

            // Find the matching season tab by iterating all data-post/data-season attributes
            let postId = null, seasonId = null;
            const tabRx = /data-post="(\d+)"[^>]*data-season="(\d+)"([^>]*)>/gi;
            let tabM;
            // We collect the full section after each tab opening tag and look for the season number text
            const tabSections = pageHtml.split(/data-post="\d+"/i).slice(1);
            const allTabsRaw = [...pageHtml.matchAll(/data-post="(\d+)"[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)(?=data-post=|<\/ul>|$)/gi)];

            for (const t of allTabsRaw) {
                const innerText = t[3].replace(/<[^>]+>/g, '').trim();
                const num = innerText.match(/(\d+)/);
                if (num && parseInt(num[1]) === parseInt(season)) {
                    postId = t[1]; seasonId = t[2]; break;
                }
            }
            // Fallback: single season â€” grab first tab
            if (!postId) {
                const fb = pageHtml.match(/data-post="(\d+)"[^>]*data-season="(\d+)"/);
                if (fb) { postId = fb[1]; seasonId = fb[2]; }
            }
            if (!postId || !seasonId) return [];

            const ajaxHtml = await req(`${MAIN_URL}/wp-admin/admin-ajax.php`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': contentUrl
                },
                body: `action=action_select_season&season=${seasonId}&post=${postId}`
            });
            if (!ajaxHtml) return [];

            // Primary: match by NxNN span
            let foundEpUrl = null;
            const epRx = /<span[^>]*class="num-epi"[^>]*>\s*(\d+)x(\d+)\s*<\/span>[\s\S]*?<a\s+href="([^"]+)"/gi;
            let epM;
            while ((epM = epRx.exec(ajaxHtml)) !== null) {
                if (parseInt(epM[1]) === parseInt(season) && parseInt(epM[2]) === parseInt(episode)) {
                    foundEpUrl = epM[3]; break;
                }
            }
            // Fallback: count articles by episode order
            if (!foundEpUrl) {
                const epLinks = [...ajaxHtml.matchAll(/<article[\s\S]*?<a\s+href="([^"]+)"/gi)];
                if (epLinks[episode - 1]) foundEpUrl = epLinks[episode - 1][1];
            }
            if (!foundEpUrl) return [];
            contentUrl = foundEpUrl;
        }

        // 5. Get server list from episode/movie page
        //    Kotlin: document.select("#aa-options > div > iframe").forEach { iframe -> iframe.attr("data-src") }
        //    The #aa-options div contains multiple child divs, each with one iframe[data-src].
        //    We can't reliably extract the outer div with regex (nested divs), so instead we
        //    locate the #aa-options block by finding "id=\"aa-options\"" and then scanning
        //    forward for ALL iframe[data-src] until we hit a clear boundary.
        const playerHtml = await req(contentUrl);
        if (!playerHtml) return [];

        const serverLinks = extractServerLinks(playerHtml);

        const streams = [];
        const seen    = new Set();

        for (const serverLink of serverLinks) {
            if (seen.has(serverLink)) continue;
            seen.add(serverLink);

            // Kotlin: val truelink = app.get(serverlink).documentLarge.selectFirst("iframe")?.attr("src")
            // Every serverLink is an internal toonstream redirect page that wraps the real embed in an iframe.
            // We ALWAYS resolve it. If no iframe found, try the serverLink itself as direct embed.
            let embedUrl = await resolveEmbed(serverLink, contentUrl);
            if (!embedUrl) embedUrl = serverLink;  // direct embed (no wrapper page)

            if (!embedUrl || seen.has(embedUrl)) continue;
            seen.add(embedUrl);

            const results2 = await dispatchExtractor(embedUrl, contentUrl);
            for (const s of results2) {
                if (s.url && !seen.has(s.url)) { seen.add(s.url); streams.push(s); }
            }
        }

        return streams;

    } catch (e) {
        console.error("[ToonStream] Fatal:", e);
        return [];
    }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  SERVER LINK EXTRACTION
//  Robustly finds ALL iframe[data-src] inside #aa-options.
//  We scan forward from the id="aa-options" marker rather than
//  trying to match the full nested-div block with a regex.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function extractServerLinks(html) {
    const links = [];
    // Find where #aa-options starts
    const startIdx = html.search(/id=["']aa-options["']/i);
    // Use full page if marker not found (fallback)
    const searchBlock = startIdx >= 0 ? html.slice(startIdx) : html;

    // Collect every iframe data-src from this block
    // Also collect plain iframe src= that look like external embeds (not same-domain)
    const dataSrcRx = /<iframe[^>]+data-src=["']([^"']+)["']/gi;
    let m;
    while ((m = dataSrcRx.exec(searchBlock)) !== null) {
        let link = m[1].replace(/&#038;/g, '&').replace(/&amp;/g, '&');
        if (!link.startsWith('http')) link = 'https:' + link;
        if (!links.includes(link)) links.push(link);
    }

    // If no data-src iframes found, fall back to ALL iframes on page (some episodes use src=)
    if (links.length === 0) {
        const srcRx = /<iframe[^>]+src=["']([^"']+)["']/gi;
        while ((m = srcRx.exec(searchBlock)) !== null) {
            let link = m[1].replace(/&#038;/g, '&').replace(/&amp;/g, '&');
            if (!link.startsWith('http')) link = 'https:' + link;
            // Skip same-domain, about:blank, javascript:
            if (link.includes(MAIN_URL) || link.startsWith('javascript') || link === 'about:blank') continue;
            if (!links.includes(link)) links.push(link);
        }
    }

    return links;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EMBED RESOLVER
//  Kotlin: app.get(serverLink).selectFirst("iframe")?.attr("src")
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function resolveEmbed(url, referer) {
    const html = await req(url, { headers: { 'Referer': referer, 'Sec-Fetch-Dest': 'iframe' } });
    if (!html) return null;
    const m = html.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    if (!m) return null;
    let resolved = m[1].replace(/&#038;/g, '&');
    if (resolved.startsWith('//')) resolved = 'https:' + resolved;
    if (!resolved.startsWith('http')) return null;
    // Don't return same-domain internal pages (would loop)
    if (resolved.includes(MAIN_URL)) return null;
    return resolved;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXTRACTOR DISPATCHER
//  Routes each embed URL to the right extractor.
//  Mirrors the registered extractors in ToonstreamProvider.kt:
//    StreamSB8, Vidmolyme, Streamruby, D000d, vidhidevip,
//    Cdnwish, FileMoonnl, Cloudy, GDMirrorbot, Techinmind,
//    EmturbovidExtractor, Zephyrflick
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function dispatchExtractor(url, referer) {
    try {
        // AWSStream / Zephyrflick
        if (matchDomain(url, ['awstream', 'zephyrflick', 'zephyr']))
            return extractAWSStream(url);

        // GDMirrorbot / Techinmind
        if (matchDomain(url, ['gdmirrorbot', 'techinmind']))
            return extractGDMirrorBot(url);

        // VidStack (Cloudy / RpmShare / UpnShare)
        if (matchDomain(url, ['cloudy.', 'upns.one', 'rpmshare', 'upnshare', 'streamp2p']))
            return extractVidStack(url, labelFor(url));

        // Emturbovid
        if (matchDomain(url, ['emturbovid', 'embturbovid']))
            return extractEmturbovid(url, labelFor(url));

        // Vidmoly
        if (matchDomain(url, ['vidmoly']))
            return extractVidmoly(url, labelFor(url));

        // StreamSB / StreamRuby
        if (matchDomain(url, ['streamsb', 'watchsb', 'streamruby', 'rubystm', 'streamruby']))
            return extractStreamSB(url, labelFor(url));

        // DoodStream
        if (matchDomain(url, ['dood', 'd000d', 'do0d']))
            return extractDoodStream(url, labelFor(url));

        // VidHide / FileLions / Filelions / vidhidepro / vidhidevip / cdnwish
        if (matchDomain(url, ['vidhide', 'filelions', 'vidhidepro', 'vidhidevip', 'cdnwish',
                               'ryderjet', 'vidhidehub', 'kinoger', 'smoothpre', 'dhtpre', 'peytonepre']))
            return extractVidHide(url, labelFor(url));

        // FileMoon / Premilkyway (Filesim-based)
        if (matchDomain(url, ['filemoon', 'premilkyway', 'file-moon', 'filesim']))
            return extractFileMoon(url, labelFor(url));

        // StreamWish family
        if (matchDomain(url, ['streamwish', 'wishembed', 'strwish', 'cdnwish', 'sfastwish',
                               'flaswish', 'awish', 'jodwish', 'swhoi', 'hlswish', 'playerwish',
                               'wishfast', 'wishonly', 'swdyu', 'mwish', 'dwish', 'obeywish',
                               'uqloads', 'nekowish', 'nekostream']))
            return extractStreamWish(url, labelFor(url));

        // Universal fallback (handles any remaining packers / raw m3u8 embeds)
        return extractUniversal(url, labelFor(url));

    } catch(e) {
        console.error('[ToonStream] Dispatch error for', url, e);
        return [];
    }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  HELPERS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function matchDomain(url, keywords) {
    const lower = url.toLowerCase();
    return keywords.some(k => lower.includes(k));
}

function labelFor(url) {
    try {
        const host = new URL(url).hostname.replace('www.', '').split('.')[0];
        return `ToonStream [${host.charAt(0).toUpperCase() + host.slice(1)}]`;
    } catch(e) { return "ToonStream [HLS]"; }
}

async function req(url, opts = {}) {
    const headers = { 'User-Agent': USER_AGENT, 'Referer': MAIN_URL, ...opts.headers };
    try {
        const r = await fetch(url, { ...opts, headers });
        return r.ok ? r.text() : null;
    } catch(e) { return null; }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXTRACTORS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// AWSStream / Zephyrflick
// Mirrors Kotlin AWSStream.getUrl â€” POST to /player/index.php?data=HASH&do=getVideo
async function extractAWSStream(url) {
    try {
        const u = new URL(url);
        const hash = u.pathname.split('/').pop();
        const apiUrl = `${u.origin}/player/index.php?data=${hash}&do=getVideo`;
        const text = await req(apiUrl, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': u.origin
            },
            body: `hash=${hash}&r=${u.origin}`
        });
        const json = JSON.parse(text);
        if (json?.videoSource && json.videoSource !== '0') {
            const name = url.includes('zephyr') ? "ToonStream [Zephyr]" : "ToonStream [AWS]";
            return [stream(json.videoSource, {}, name)];
        }
    } catch(e) {}
    return [];
}

// VidStack (Cloudy, RpmShare, UpnShare)
// Mirrors Kotlin VidStack â€” POST to /api/source/ID
async function extractVidStack(url, name) {
    try {
        const u = new URL(url);
        const id = u.pathname.split('/').pop();
        const text = await req(`${u.origin}/api/source/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': url, 'Origin': u.origin },
            body: `r=${encodeURIComponent(url)}&d=${u.hostname}`
        });
        const json = JSON.parse(text);
        if (json?.data) {
            return json.data
                .filter(i => i.file && (i.file.includes('.m3u8') || i.type === 'hls' || i.type === 'application/x-mpegURL'))
                .map(i => stream(i.file, { 'Referer': url }, name));
        }
    } catch(e) {}
    return [];
}

// Emturbovid
// Mirrors Kotlin EmturbovidExtractor â€” finds var urlPlay = 'URL'
async function extractEmturbovid(url, name) {
    try {
        const html = await req(url, { headers: { 'Referer': url + '/' } });
        if (!html) return [];
        const m = html.match(/var\s+urlPlay\s*=\s*['"]([^'"]+)['"]/);
        if (m) return [stream(m[1], { 'Referer': url + '/' }, name)];
    } catch(e) {}
    return [];
}

// Vidmoly
// Unpacks script, finds master.m3u8 CDN URL
async function extractVidmoly(url, name) {
    try {
        let embedUrl = url;
        const idM = url.match(/\/(?:embed-|w\/)([a-zA-Z0-9]+)/);
        if (idM) embedUrl = `${new URL(url).origin}/embed-${idM[1]}.html`;

        const origin = new URL(url).origin;
        const html = await req(embedUrl, {
            headers: { 'Referer': origin + '/', 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate' }
        });
        if (!html) return [];

        let content = unpackAll(html);
        const m = content.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*?)["'`]/);
        if (m) return [stream(m[1], { 'Referer': origin + '/' }, name)];
    } catch(e) {}
    return [];
}

// StreamSB / StreamRuby
// Mirrors Kotlin StreamSB â€” uses /sources48/ or /e/ API endpoint
async function extractStreamSB(url, name) {
    try {
        // StreamRuby: simpler â€” just scrape the page for m3u8
        if (url.includes('streamruby') || url.includes('rubystm')) {
            const newUrl = url.includes('/e/') ? url.replace('/e/', '/') : url;
            const html = await req(newUrl, { headers: { 'Referer': url } });
            if (html) {
                let content = unpackAll(html);
                const m = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
                if (m) return [stream(m[1], { 'Referer': url }, name)];
            }
            return [];
        }
        // StreamSB: uses encoded API
        const urlObj = new URL(url);
        let videoId = urlObj.pathname.split('/').filter(Boolean).pop() || '';
        if (videoId.endsWith('.html')) videoId = videoId.slice(0, -5);

        // Convert to hex for the API
        const hexId  = Array.from(videoId).map(c => c.charCodeAt(0).toString(16)).join('');
        const apiUrl = `${urlObj.origin}/sources48/${hexId}`;
        const text   = await req(apiUrl, {
            headers: {
                'watchsb': 'sbstream',
                'Referer': url,
                'User-Agent': USER_AGENT
            }
        });
        const json = JSON.parse(text);
        if (json?.stream_data?.file) {
            return [stream(json.stream_data.file, { 'Referer': urlObj.origin + '/' }, name)];
        }
    } catch(e) {}
    // Fallback to universal
    return extractUniversal(url, name);
}

// DoodStream (d000d.com)
// Mirrors Kotlin DoodLaExtractor
async function extractDoodStream(url, name) {
    try {
        const html = await req(url, { headers: { 'Referer': 'https://d000d.com/' } });
        if (!html) return [];
        const passM = html.match(/\?token=([^&"'\s]+).*?expiry=/s) || html.match(/pass_md5['":\s/]+([^'"<\s]+)/);
        const tokenM = html.match(/\?token=([^&'"]+)/);
        // DoodStream constructs the URL from /pass_md5/ + random string + token + time
        const md5M = html.match(/\/pass_md5\/[^\s"']+/);
        if (md5M) {
            const origin = new URL(url).origin;
            const md5Url = origin + md5M[0];
            const md5Resp = await req(md5Url, { headers: { 'Referer': url } });
            if (md5Resp) {
                const rand  = Math.random().toString(36).substring(2, 14);
                const ts    = Date.now();
                const token = tokenM?.[1] || '';
                const finalUrl = `${md5Resp.trim()}${rand}?token=${token}&expiry=${ts}`;
                return [stream(finalUrl, { 'Referer': origin + '/' }, name, false)];
            }
        }
    } catch(e) {}
    return extractUniversal(url, name);
}

// VidHide / FileLions / VidHidePro family
// Mirrors Kotlin VidHidePro â€” unpacks script, finds m3u8 after "hls2:" or "hls4:" or "file:"
async function extractVidHide(url, name) {
    try {
        // Normalise /d/, /download/, /file/ â†’ /v/
        const embedUrl = url.replace(/\/(d|download|file|f)\//, '/v/');
        const html = await req(embedUrl, { headers: { 'Referer': embedUrl + '/', 'Origin': new URL(url).origin } });
        if (!html) return [];

        let content = unpackAll(html);
        // Extract after "var links" if present (VidHidePro specific)
        if (content.includes('var links')) content = content.split('var links').slice(1).join('');

        const m3u8s = [...content.matchAll(/:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi)];
        return m3u8s.map(m => stream(m[1], { 'Referer': new URL(url).origin + '/', 'Origin': new URL(url).origin }, name));
    } catch(e) {}
    return [];
}

// FileMoon / Filemoon.nl (Filesim-based)
// Mirrors Kotlin Filesim / FileMoonnl â€” unpacks JuicyCodes / packer
async function extractFileMoon(url, name) {
    try {
        const html = await req(url, { headers: { 'Referer': url } });
        if (!html) return [];
        let content = unpackAll(html);
        const m = content.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/);
        if (m) return [stream(m[1], { 'Referer': url }, name)];
    } catch(e) {}
    return [];
}

// StreamWish family
// Mirrors Kotlin StreamWishExtractor â€” unpacks JWPlayer sources
async function extractStreamWish(url, name) {
    try {
        // Normalise /f/ or /e/ â†’ base URL
        const vid = url.match(/\/(?:f|e)\/([a-zA-Z0-9]+)/)?.[1];
        const origin = new URL(url).origin;
        const embedUrl = vid ? `${origin}/${vid}` : url;

        const html = await req(embedUrl, { headers: { 'Referer': origin + '/', 'Origin': origin } });
        if (!html) return [];

        let content = unpackAll(html);
        const m = content.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (m) return [stream(m[1], { 'Referer': origin + '/' }, name)];

        // Also try sources: [{file:"..."}]
        const srcM = content.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (srcM) return [stream(srcM[1], { 'Referer': origin + '/' }, name)];
    } catch(e) {}
    return [];
}

// GDMirrorbot / Techinmind
// Mirrors Kotlin GDMirrorbot.getUrl
async function extractGDMirrorBot(url) {
    const res = [];
    try {
        const u = new URL(url);
        let host = u.origin, sid = '';

        if (url.includes('key=')) {
            const pageText = await req(url);
            if (!pageText) return [];
            const finalId    = pageText.match(/FinalID\s*=\s*"([^"]+)"/)?.[1];
            const myKey      = pageText.match(/myKey\s*=\s*"([^"]+)"/)?.[1];
            const idType     = pageText.match(/idType\s*=\s*"([^"]+)"/)?.[1] || 'imdbid';
            const baseUrlM   = pageText.match(/let\s+baseUrl\s*=\s*"([^"]+)"/);
            if (baseUrlM) try { host = new URL(baseUrlM[1]).origin; } catch(e) {}

            if (finalId && myKey) {
                let apiUrl;
                if (url.includes('/tv/')) {
                    const s = url.match(/\/tv\/\d+\/(\d+)\//)?.[1] || '1';
                    const e = url.match(/\/tv\/\d+\/\d+\/(\d+)/)?.[1] || '1';
                    apiUrl = `${host}/myseriesapi?tmdbid=${finalId}&season=${s}&epname=${e}&key=${myKey}`;
                } else {
                    apiUrl = `${host}/mymovieapi?${idType}=${finalId}&key=${myKey}`;
                }
                const apiJ = JSON.parse(await req(apiUrl) || 'null');
                if (apiJ?.data?.[0]?.fileslug) sid = apiJ.data[0].fileslug;
            }
        }

        if (!sid) sid = u.pathname.split('/').filter(Boolean).pop() || '';
        if (!sid) return [];

        const helperText = await req(`${host}/embedhelper.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `sid=${sid}`
        });
        if (!helperText) return [];
        const data = JSON.parse(helperText);
        if (!data.siteUrls || !data.mresult) return [];

        const siteUrls     = data.siteUrls;
        const friendlyNames = data.siteFriendlyNames || {};
        let mresult = {};
        if (typeof data.mresult === 'object') mresult = data.mresult;
        else try { mresult = JSON.parse(atob(data.mresult)); } catch(e) {}

        for (const key of Object.keys(siteUrls)) {
            if (!mresult[key]) continue;
            const fullUrl  = `${siteUrls[key].replace(/\/$/, '')}/${mresult[key].replace(/^\//, '')}`;
            const friendly = friendlyNames[key] || key;

            const subRes = await dispatchExtractor(fullUrl, url);
            res.push(...subRes);
        }
    } catch(e) { console.log('[ToonStream] GDMirror Error', e); }
    return res;
}

// Universal fallback â€” recursive packer unpack + raw m3u8 scrape
async function extractUniversal(url, name) {
    const res = [];
    try {
        const html = await req(url, { headers: { 'Referer': url } });
        if (!html) return [];
        const content = unpackAll(html);
        const seen = new Set();

        for (const m of content.matchAll(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/gi)) {
            const link = m[1].replace(/\\/g, '');
            if (link.includes('error') || link.includes('red/pixel') || seen.has(link)) continue;
            seen.add(link);
            const autoName = name || (
                url.includes('filemoon') || url.includes('premilkyway') ? 'ToonStream [FileMoon]' :
                url.includes('dood') || url.includes('d000d')           ? 'ToonStream [Dood]'     :
                url.includes('streamruby') || url.includes('rubystm')   ? 'ToonStream [Ruby]'     :
                url.includes('wish')                                     ? 'ToonStream [Wish]'     :
                url.includes('vidhide') || url.includes('filelions')    ? 'ToonStream [VidHide]'  :
                                                                           'ToonStream [HLS]'
            );
            res.push(stream(link, { 'Referer': url }, autoName));
        }
    } catch(e) {}
    return res;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  UTILITIES
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Build a stream object
function stream(url, headers, name, isHLS = true) {
    return { name, title: 'Auto / Multi-Audio', type: 'url', url, headers };
}

// Recursively unpack p.a.c.k.e.r (up to 5 passes)
function unpackAll(content) {
    let result = content;
    for (let i = 0; i < 5; i++) {
        const packed = result.match(/(eval\(function\(p,a,c,k,e,(?:d|r)\)[\s\S]*?\.split\('\|'\)\)(?:\))?)/);
        if (!packed) break;
        const up = unpack(packed[1]);
        if (!up || up === result) break;
        result = up;
    }
    return result;
}

function unpack(p) {
    try {
        const params = p.match(/\}\s*\(\s*'([\s\S]*)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!params) return null;
        let [, payload, radixStr, , dictStr] = params;
        const radix = parseInt(radixStr);
        const dict  = dictStr.split('|');
        return payload.replace(/\b\w+\b/g, w => {
            const idx = parseInt(w, radix);
            return (Number.isFinite(idx) && dict[idx]) ? dict[idx] : w;
        });
    } catch(e) { return null; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { getStreams };
else global.ToonStreamProvider = { getStreams };
