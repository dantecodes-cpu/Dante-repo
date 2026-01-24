let title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
    const cleanTitle = title.trim();
    const year = mediaType === 'movie' ? (tmdbData.release_date || '').split('-')[0] : (tmdbData.first_air_date || '').split('-')[0];

    console.log(`[ToonStream] Searching: "${cleanTitle}" (${year})`);

    // ==========================================================
    // 2. SEARCH TOONSTREAM
    // ==========================================================
    const searchUrl = `${MAIN_URL}/page/1/?s=${encodeURIComponent(cleanTitle)}`;
    const searchHtml = await fetchHtml(searchUrl);

    if (!searchHtml) return [];

    let results = [];
    const linkRegex = /href="([^"]*toonstream\.one\/(?:movies|series)\/[^"]+)"/gi;
    let match;
    
    while ((match = linkRegex.exec(searchHtml)) !== null) {
        const url = match[1];
        const slug = url.split('/').filter(Boolean).pop();
        const inferredTitle = slug.replace(/-/g, ' ');
        
        if (!results.some(r => r.url === url)) {
            results.push({ url, title: inferredTitle });
        }
    }

    // --- FILTERING: Avoid Live Action if not requested ---
    if (!cleanTitle.toLowerCase().includes('live action')) {
        const cartoonResults = results.filter(r => !r.url.includes('live-action'));
        if (cartoonResults.length > 0) {
            results = cartoonResults; // Prioritize cartoons
        }
    }

    // --- MATCHING LOGIC ---
    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = normalize(title);
    
    let matchedItem = results.find(r => normalize(r.title).includes(target)) || 
                      results.find(r => target.includes(normalize(r.title)));

    if (!matchedItem) {
        console.log(`[ToonStream] No content found for "${cleanTitle}"`);
        return [];
    }

    let contentUrl = matchedItem.url;
    console.log(`[ToonStream] Selected: ${contentUrl}`);

    // ==========================================================
    // 3. HANDLE TV EPISODES (AJAX)
    // ==========================================================
    if (mediaType === 'tv') {
        const pageHtml = await fetchHtml(contentUrl);
        
        // Regex to find Season ID
        const seasonRegex = new RegExp(`data-post="([^"]+)"[^>]*data-season="([^"]+)"[^>]*>.*?Season\\s*${season}\\b`, 'i');
        const sMatch = pageHtml.match(seasonRegex);

        if (!sMatch) {
            console.log(`[ToonStream] Season ${season} not found.`);
            return [];
        }

        // AJAX Request
        const formData = new URLSearchParams();
        formData.append('action', 'action_select_season');
        formData.append('season', sMatch[2]);
        formData.append('post', sMatch[1]);

        const ajaxHtml = await fetchHtml(`${MAIN_URL}/wp-admin/admin-ajax.php`, contentUrl, 'POST', formData);
        if (!ajaxHtml) return [];

        // Find specific episode link
        const epRegex = /<span class="num-epi">(\d+)x(\d+)<\/span>[\s\S]*?<a href="([^"]+)"/gi;
        let epMatch, foundEpUrl = null;
        while ((epMatch = epRegex.exec(ajaxHtml)) !== null) {
            if (parseInt(epMatch[1]) == season && parseInt(epMatch[2]) == episode) {
                foundEpUrl = epMatch[3];
                break;
            }
        }

        if (!foundEpUrl) {
            console.log(`[ToonStream] Episode S${season}E${episode} not found.`);
            return [];
        }
        contentUrl = foundEpUrl;
    }

    // ==========================================================
    // 4. EXTRACT PLAYERS
    // ==========================================================
    const playerHtml = await fetchHtml(contentUrl);
    
    // Find internal embeds
    const embedRegex = /(?:data-src|src)="([^"]*toonstream\.one\/home\/\?trembed=[^"]+)"/gi;
    const rawEmbeds = [];
    let em;
    while ((em = embedRegex.exec(playerHtml)) !== null) {
        rawEmbeds.push(em[1].replace(/&#038;/g, '&'));
    }
    
    console.log(`[ToonStream] Processing ${rawEmbeds.length} embeds...`);

    const streams = [];
    const processedHosts = new Set();
    
    // Sort embeds to try 0,1 first
    rawEmbeds.sort();

    // Process first 10 embeds to avoid timeouts
    for (const internalEmbed of rawEmbeds.slice(0, 10)) {
        try {
            const realHost = await resolveRedirect(internalEmbed, contentUrl);
            if (!realHost || processedHosts.has(realHost)) continue;
            processedHosts.add(realHost);

            let extracted = false;

            // A. AWSStream / Zephyrflick (Fastest)
            if (realHost.includes('awstream') || realHost.includes('zephyrflick')) {
                const m3u8 = await extractAWSStream(realHost);
                if (m3u8) {
                    streams.push({ name: "ToonStream [AWS]", title: "1080p (Fast)", type: "url", url: m3u8 });
                    extracted = true;
                }
            }

            // B. StreamRuby (Remove /e/ to unpack)
            if (!extracted && realHost.includes('streamruby')) {
                const cleanUrl = realHost.replace('/e/', '/');
                const m3u8Links = await extractGeneric(cleanUrl);
                if (m3u8Links.length > 0) {
                    m3u8Links.forEach(link => streams.push({ name: "ToonStream [Ruby]", title: "Auto", type: "url", url: link }));
                    extracted = true;
                }
            }

            // C. Generic JS Packer (VidHide, StreamWish)
            if (!extracted) {
                const m3u8Links = await extractGeneric(realHost);
                if (m3u8Links.length > 0) {
                    m3u8Links.forEach(link => streams.push({ name: "ToonStream [HLS]", title: "Auto", type: "url", url: link }));
                    extracted = true;
                }
            }

            // D. Fallback Iframe
            if (!extracted) {
                const host = new URL(realHost).hostname.replace('www.', '');
                streams.push({ 
                    name: "ToonStream [Embed]", 
                    title: host, 
                    type: "iframe", 
                    url: realHost 
                });
            }
        } catch (innerErr) { }
    }

    return streams;

} catch (e) {
    console.error(`[ToonStream] Error: ${e.message}`);
    return [];
}
