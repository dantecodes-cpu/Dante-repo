// ToonStream Provider for Nuvio
// Version: 1.0 (Stable)
// Features: Native AWS/Ruby Extraction, AJAX Season Support, Loose Search

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const MAIN_URL = "https://toonstream.one";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

console.log('[ToonStream] ✅ Provider Loaded');

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        // ==========================================================
        // 1. TMDB LOOKUP
        // ==========================================================
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbResp = await req(tmdbUrl);
        const tmdbData = JSON.parse(tmdbResp);
        
        let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        // Clean title: "Ben 10: Alien Force" -> "Ben 10 Alien Force"
        const cleanTitle = title.replace(/[:\-]/g, ' ').replace(/\s+/g, ' ').trim();
        const year = mediaType === 'movie' ? (tmdbData.release_date || '').split('-')[0] : (tmdbData.first_air_date || '').split('-')[0];

        console.log(`[ToonStream] Searching: "${cleanTitle}" (${year})`);

        // ==========================================================
        // 2. SEARCH TOONSTREAM
        // ==========================================================
        const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
        const searchHtml = await req(searchUrl);

        if (!searchHtml) return [];

        const results = [];
        const articles = searchHtml.split('<article');
        
        for (const article of articles) {
            if (!article.includes('href=')) continue;

            const urlMatch = article.match(/href="([^"]+)"/);
            const titleMatch = article.match(/<h[2-3][^>]*>([^<]+)<\/h[2-3]>/);

            if (urlMatch && titleMatch) {
                let rawUrl = urlMatch[1];
                if (!rawUrl.startsWith('http')) rawUrl = MAIN_URL + rawUrl;
                const rawTitle = titleMatch[1].replace('Watch Online', '').trim();
                
                if (rawUrl.includes('/movies/') || rawUrl.includes('/series/')) {
                    results.push({ url: rawUrl, title: rawTitle });
                }
            }
        }

        // --- MATCHING LOGIC ---
        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(title);
        
        // A. Exact Match
        let match = results.find(r => normalize(r.title) === target);

        // B. Slug Match (Crucial for "Kung Fu Panda 4" -> "kung-fu-panda-4")
        if (!match) {
            const slugTarget = cleanTitle.toLowerCase().replace(/\s+/g, '-');
            match = results.find(r => r.url.toLowerCase().includes(slugTarget));
        }

        // C. Starts With / Fuzzy (Crucial for short titles like "Ben 10")
        if (!match) {
            match = results.find(r => normalize(r.title).startsWith(target));
        }

        if (!match) {
            console.log(`[ToonStream] No match found.`);
            return [];
        }

        let contentUrl = match.url;
        console.log(`[ToonStream] Selected: ${match.title}`);

        // ==========================================================
        // 3. HANDLE TV EPISODES
        // ==========================================================
        if (mediaType === 'tv') {
            const pageHtml = await req(contentUrl);
            
            // Extract Season ID and Post ID
            const seasonRegex = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
            const sMatch = pageHtml.match(seasonRegex);

            if (!sMatch) {
                console.log(`[ToonStream] Season ${season} not found.`);
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

            // Match "1x1", "01x01", or just "Episode 1" if number is explicit
            const epRegex = /<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
            let epMatch, foundEpUrl = null;
            
            while ((epMatch = epRegex.exec(ajaxHtml)) !== null) {
                if (parseInt(epMatch[1]) == season && parseInt(epMatch[2]) == episode) {
                    foundEpUrl = epMatch[3];
                    break;
                }
            }

            if (!foundEpUrl) {
                console.log(`[ToonStream] Episode ${season}x${episode} not found.`);
                return [];
            }
            contentUrl = foundEpUrl;
        }

        // ==========================================================
        // 4. EXTRACT PLAYERS
        // ==========================================================
        console.log(`[ToonStream] Scraping: ${contentUrl}`);
        const playerHtml = await req(contentUrl);
        
        const embedRegex = /(?:data-src|src)="([^"]*toonstream\.one\/home\/\?trembed=[^"]+)"/gi;
        const matches = [...playerHtml.matchAll(embedRegex)];
        
        console.log(`[ToonStream] Found ${matches.length} embeds`);
        const streams = [];
        
        // Limit to first 12 embeds to prevent timeout
        for (const m of matches.slice(0, 12)) {
            try {
                const embedUrl = m[1].replace(/&#038;/g, '&');
                const realUrl = await resolveRedirect(embedUrl, contentUrl);
                if (!realUrl) continue;

                let extracted = false;

                // A. Native AWS/Zephyr Extraction
                if (realUrl.includes('awstream') || realUrl.includes('zephyrflick')) {
                    const awsLink = await extractAWSStream(realUrl);
                    if (awsLink) { streams.push(awsLink); extracted = true; }
                }
                
                // B. StreamRuby Extraction
                if (!extracted && realUrl.includes('streamruby')) {
                    const rubyLinks = await extractStreamRuby(realUrl);
                    if (rubyLinks.length > 0) { streams.push(...rubyLinks); extracted = true; }
                }

                // C. Generic Fallback (VidHide, Turboviplay, etc)
                if (!extracted) {
                    const genericLinks = await extractGeneric(realUrl);
                    if (genericLinks.length > 0) { streams.push(...genericLinks); }
                }
                
                // D. Iframe Fallback (Last Resort)
                if (!extracted) {
                     const host = new URL(realUrl).hostname.replace('www.', '');
                     streams.push({ name: "ToonStream [Embed]", title: host, type: "iframe", url: realUrl });
                }

            } catch (err) { }
        }

        return streams;

    } catch (e) {
        console.error(`[ToonStream] Error: ${e.message}`);
        return [];
    }
}

// ==========================================================
// HELPERS
// ==========================================================

async function req(url, opts = {}) {
    const headers = { 'User-Agent': USER_AGENT, 'Referer': MAIN_URL, ...opts.headers };
    const response = await fetch(url, { ...opts, headers });
    return response.ok ? response.text() : null;
}

async function resolveRedirect(url, referer) {
    const html = await req(url, { headers: { Referer: referer } });
    if (!html) return null;
    const match = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    return match ? (match[1].startsWith('//') ? 'https:' + match[1] : match[1]) : null;
}

async function extractAWSStream(url) {
    try {
        const domain = new URL(url).origin;
        const hash = url.split('/').pop().split('?')[0];
        const apiUrl = `${domain}/player/index.php?data=${hash}&do=getVideo`;
        const body = `hash=${hash}&r=${domain}`;
        const jsonText = await req(apiUrl, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        });
        const json = JSON.parse(jsonText);
        if (json && json.videoSource && json.videoSource !== '0') {
            return { name: "ToonStream [AWS]", title: "1080p (Fast)", type: "url", url: json.videoSource };
        }
    } catch (e) { return null; }
}

async function extractStreamRuby(url) {
    try {
        const cleanUrl = url.replace('/e/', '/'); 
        const html = await req(cleanUrl);
        const match = html.match(/file:\s*"([^"]+\.m3u8[^"]*)"/);
        if (match) return [{ name: "ToonStream [Ruby]", title: "Auto", type: "url", url: match[1] }];
    } catch (e) { return []; }
    return [];
}

async function extractGeneric(url) {
    const res = [];
    try {
        const html = await req(url);
        if (!html) return [];
        const packerRegex = /(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\))/;
        const packed = html.match(packerRegex);
        let content = html;
        if (packed) {
            const unpacked = unpack(packed[1]);
            if (unpacked) content += unpacked;
        }
        const m3u8Regex = /(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/gi;
        let m;
        while ((m = m3u8Regex.exec(content)) !== null) {
            const link = m[1].replace(/\\/g, '');
            if (!res.some(r => r.url === link) && !link.includes('red/pixel')) {
                res.push({ name: "ToonStream [HLS]", title: "Auto", type: "url", url: link
