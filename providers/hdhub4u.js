// HDHub4u Scraper for Nuvio
// Ported from Kotlin source (HDhub4uProvider.kt, Extractors.kt, Utils.kt)
// Strict Promise-based implementation (No async/await)

const cheerio = require('cheerio-without-node-native');

// Configuration
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // Using a public test key
let MAIN_URL = "https://hdhub4u.frl"; // Default, updates dynamically
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";

// Header Management
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Cookie": "xla=s4t",
    "Referer": `${MAIN_URL}/`,
};

// =================================================================================
// UTILS (Ported from Utils.kt)
// =================================================================================

// Kotlin: pen(value)
function rot13(str) {
    return str.replace(/[a-zA-Z]/g, function(c) {
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}

// Base64 Decode
function atob(str) {
    return Buffer.from(str, 'base64').toString('binary');
}

// Base64 Encode
function btoa(str) {
    return Buffer.from(str, 'binary').toString('base64');
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Logic to extract quality from string (4k, 1080p, etc.)
function getQualityFromString(str) {
    if (!str) return 'Unknown';
    const match = str.match(/(\d{3,4})[pP]|4[kK]/);
    if (match) {
        if (match[0].toLowerCase() === '4k') return '4K';
        return match[1] + 'p';
    }
    return 'Unknown';
}

function getQualityScore(qualityStr) {
    const map = { '4K': 5, '2160p': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1 };
    return map[qualityStr] || 0;
}

// Kotlin: getRedirectLinks(url) - The heavy lifter for de-obfuscation
function getRedirectLinks(url) {
    return fetch(url, { headers: HEADERS })
        .then(res => res.text())
        .then(html => {
            // Regex from Kotlin: "s\\('o','([A-Za-z0-9+/=]+)'|ck\\('_wp_http_\\d+','([^']+)'"
            const regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
            let combinedString = "";
            let match;
            
            while ((match = regex.exec(html)) !== null) {
                const val = match[1] || match[2];
                if (val) combinedString += val;
            }

            if (!combinedString) return url;

            try {
                // Logic: base64Decode(pen(base64Decode(base64Decode(combinedString))))
                const step1 = atob(combinedString);
                const step2 = atob(step1);
                const step3 = rot13(step2);
                const step4 = atob(step3);
                
                const json = JSON.parse(step4);
                
                const oParam = json.o ? atob(json.o).trim() : "";
                
                if (oParam) return oParam;

                // If 'o' is missing, check for data/blog_url fallback
                const dataParam = json.data ? btoa(json.data).trim() : ""; // Kotlin uses encode() here
                const blogUrl = json.blog_url ? json.blog_url.trim() : "";

                if (blogUrl && dataParam) {
                     return fetch(`${blogUrl}?re=${dataParam}`, { headers: HEADERS })
                        .then(r => r.text())
                        .then(t => {
                            // Extract body text logic from Kotlin
                            const $ = cheerio.load(t);
                            return $('body').text().trim() || url;
                        });
                }
                
                return url;

            } catch (e) {
                console.log("[HDHub4u] Redirect decode error:", e);
                return url;
            }
        }).catch(() => url);
}

// =================================================================================
// EXTRACTORS (Ported from Extractors.kt)
// =================================================================================

function extractHubCloud(url, referer, quality) {
    // Handle hubcloud.ink -> hubcloud.dad replacement
    let targetUrl = url.replace("hubcloud.ink", "hubcloud.dad");
    
    return fetch(targetUrl, { headers: { ...HEADERS, Referer: referer } })
        .then(res => res.text())
        .then(html => {
            let finalUrl = targetUrl;
            let pageHtml = html;
            
            // Check for JS redirection: var url = '...'
            const jsRedirect = html.match(/var url = '([^']+)'/);
            if (!targetUrl.includes("hubcloud.php") && jsRedirect) {
                finalUrl = jsRedirect[1];
                return fetch(finalUrl, { headers: { ...HEADERS, Referer: targetUrl } })
                    .then(r => r.text())
                    .then(t => ({ html: t, url: finalUrl }));
            }
            return { html: pageHtml, url: finalUrl };
        })
        .then(({ html, url }) => {
            const $ = cheerio.load(html);
            const size = $('i#size').text().trim();
            const title = $('div.card-header').text().trim();
            const links = [];

            const elements = $('div.card-body h2 a.btn');
            
            // We need to process these sequentially or in parallel using Promise.all
            const promises = elements.map((i, el) => {
                const linkUrl = $(el).attr('href');
                const btnText = $(el).text().trim();
                const server = "HDHub4u " + (btnText || "HubCloud");
                
                // Common props
                const streamBase = {
                    title: title || "Unknown",
                    quality: quality,
                    size: size || "Unknown",
                    headers: HEADERS,
                    provider: 'hdhub4u'
                };

                if (btnText.includes("Download File") || btnText.includes("FSL Server") || btnText.includes("S3 Server") || btnText.includes("Mega Server")) {
                    links.push({ ...streamBase, name: server, url: linkUrl });
                    return Promise.resolve();
                } 
                else if (btnText.includes("BuzzServer")) {
                    // Logic: GET request, check hx-redirect header
                    return fetch(`${linkUrl}/download`, { method: 'GET', headers: { ...HEADERS, Referer: linkUrl }, redirect: 'manual' })
                        .then(res => {
                            const hxRedirect = res.headers.get('hx-redirect');
                            if (hxRedirect) {
                                links.push({ ...streamBase, name: server, url: hxRedirect });
                            }
                        }).catch(e => console.log("BuzzServer Error", e));
                }
                else if (linkUrl.includes("pixeldra")) {
                    // Convert to direct download
                    const fileId = linkUrl.split('/').pop();
                    const dlUrl = `https://pixeldrain.com/api/file/${fileId}?download`;
                    links.push({ ...streamBase, name: "HDHub4u PixelDrain", url: dlUrl });
                    return Promise.resolve();
                }
                else if (btnText.includes("10Gbps")) {
                    // Logic: Follow redirects up to 3 times to find 'link='
                    const follow = (u, count) => {
                        if (count > 3) return Promise.resolve(null);
                        return fetch(u, { method: 'GET', redirect: 'manual' })
                            .then(res => {
                                const loc = res.headers.get('location');
                                if (!loc) return null;
                                if (loc.includes('link=')) return loc.split('link=')[1];
                                return follow(loc, count + 1);
                            });
                    };
                    return follow(linkUrl, 0).then(final => {
                        if (final) links.push({ ...streamBase, name: server, url: final });
                    });
                }
                
                return Promise.resolve();
            }).get();

            return Promise.all(promises).then(() => links);
        }).catch(e => {
            console.log("HubCloud Extract Error", e);
            return [];
        });
}

function extractHubCdn(url) {
    return fetch(url, { headers: HEADERS })
        .then(res => res.text())
        .then(html => {
            // Regex from Kotlin: r=([A-Za-z0-9+/=]+)
            const match = html.match(/r=([A-Za-z0-9+/=]+)/);
            if (match) {
                const decoded = atob(match[1]);
                const finalLink = decoded.split('link=')[1];
                if (finalLink) {
                    return [{
                        name: "HDHub4u HubCDN",
                        url: finalLink,
                        quality: "Unknown",
                        provider: "hdhub4u"
                    }];
                }
            }
            return [];
        }).catch(() => []);
}

function resolveExtractor(url, referer, quality) {
    const u = url.toLowerCase();
    
    // Recursive redirection check first (handled in getRedirectLinks mostly)
    
    if (u.includes("hubcloud") || u.includes("hubdrive")) {
        return extractHubCloud(url, referer, quality);
    }
    if (u.includes("hubcdn")) {
        return extractHubCdn(url);
    }
    if (u.includes("pixeldrain")) {
        const fileId = url.split('/').pop();
        return Promise.resolve([{
            name: "HDHub4u PixelDrain",
            url: `https://pixeldrain.com/api/file/${fileId}?download`,
            quality: quality,
            provider: "hdhub4u"
        }]);
    }
    
    // Fallback: Return raw link if it looks like a video
    if (u.match(/\.(mp4|mkv)$/)) {
        return Promise.resolve([{
             name: "HDHub4u Direct",
             url: url,
             quality: quality,
             provider: "hdhub4u"
        }]);
    }
    
    return Promise.resolve([]);
}

// =================================================================================
// MAIN PROVIDER LOGIC (Ported from HDhub4uProvider.kt)
// =================================================================================

function updateDomain() {
    return fetch(DOMAINS_URL)
        .then(r => r.json())
        .then(d => {
            if (d && d.HDHUB4u) {
                MAIN_URL = d.HDHUB4u;
                HEADERS.Referer = `${MAIN_URL}/`;
            }
        })
        .catch(() => {}); // Fail silently, use default
}

function search(query) {
    return updateDomain().then(() => {
        const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
        return fetch(searchUrl, { headers: HEADERS });
    })
    .then(res => res.text())
    .then(html => {
        const $ = cheerio.load(html);
        const results = [];
        
        $('.recent-movies > li.thumb').each((i, el) => {
            const title = $(el).find('figcaption p').first().text().trim();
            const link = $(el).find('figure a').attr('href');
            results.push({ title, link });
        });
        
        return results;
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
    // 1. Get Metadata from TMDB
    const typePath = mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbUrl = `https://api.themoviedb.org/3/${typePath}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    return fetch(tmdbUrl).then(r => r.json()).then(meta => {
        const title = mediaType === 'tv' ? meta.name : meta.title;
        const year = (meta.release_date || meta.first_air_date || "").substring(0, 4);
        
        // 2. Search HDHub4u
        // TV Logic: Search "Title" first, maybe "Title Season X" if not found, but start broad
        let query = title;
        if (mediaType === 'tv') query += ` Season ${season}`;

        return search(query).then(results => {
            if (!results.length) return [];

            // Simple Fuzzy Match
            const targetResult = results.find(r => r.title.toLowerCase().includes(title.toLowerCase()));
            const pageUrl = targetResult ? targetResult.link : results[0].link;
            
            if (!pageUrl) return [];

            // 3. Parse Page
            return fetch(pageUrl, { headers: HEADERS })
                .then(r => r.text())
                .then(html => {
                    const $ = cheerio.load(html);
                    const linksToProcess = [];

                    if (mediaType === 'movie') {
                        // Movie Logic: Select h3 a, h4 a with quality tags
                        $('h3 a, h4 a').each((i, el) => {
                            const txt = $(el).text();
                            const href = $(el).attr('href');
                            if (txt.match(/480|720|1080|2160|4K/i) && href) {
                                linksToProcess.push({ url: href, quality: getQualityFromString(txt) });
                            }
                        });
                    } else {
                        // TV Logic (Complex)
                        // Case A: Direct Links in h4 (e.g., "Episode 1", "E01")
                        const episodeRegex = /(?:Episode|E)\s*(\d+)/i;
                        
                        // Map of Episode Number -> Links
                        const episodeMap = {}; 

                        $('h3, h4').each((i, el) => {
                            const headerText = $(el).text();
                            const epMatch = headerText.match(episodeRegex);
                            const epNumFromHeader = epMatch ? parseInt(epMatch[1]) : null;
                            
                            // Check if this is a "Direct Link Block" (Quality links that redirect to episode list)
                            // Kotlin: isDirectLinkBlock = element.select("a").any { matches quality }
                            const hasQualityLinks = $(el).find('a').toArray().some(a => $(a).text().match(/1080|720|4K/i));

                            if (hasQualityLinks) {
                                // This header contains links to a PACK or specialized page
                                const links = $(el).find('a').map((j, a) => $(a).attr('href')).get();
                                
                                // We must resolve these links to find episodes inside
                                links.forEach(l => {
                                    linksToProcess.push({ 
                                        url: l, 
                                        isRedirectBlock: true, 
                                        targetEpisode: episode // pass current requested episode to filter later
                                    });
                                });
                            } 
                            else if (epNumFromHeader === episode) {
                                // Direct match for the requested episode in h3/h4
                                const links = $(el).find('a').map((j, a) => $(a).attr('href')).get();
                                links.forEach(l => {
                                    linksToProcess.push({ url: l, quality: "Unknown" }); // Quality inferred later or unknown
                                });

                                // Check siblings until next hr/h3/h4 (Kotlin logic)
                                let next = $(el).next();
                                while(next.length && !next.is('hr') && !next.is('h3') && !next.is('h4')) {
                                    next.find('a').each((k, a) => {
                                        linksToProcess.push({ url: $(a).attr('href'), quality: "Unknown" });
                                    });
                                    next = next.next();
                                }
                            }
                        });
                    }

                    // 4. Process all gathered links
                    // We use Promise.all to resolve redirects and extractors
                    const streamPromises = linksToProcess.map(linkObj => {
                        const { url, quality, isRedirectBlock, targetEpisode } = linkObj;

                        if (isRedirectBlock) {
                            // Resolve the redirect, get the new page, look for the specific episode
                            return getRedirectLinks(url).then(resolved => {
                                return fetch(resolved, { headers: HEADERS }).then(r => r.text()).then(subHtml => {
                                    const $$ = cheerio.load(subHtml);
                                    const subLinks = [];
                                    
                                    $$('h5 a').each((i, el) => {
                                        const t = $$(el).text();
                                        const match = t.match(/(?:Episode|E)\s*(\d+)/i);
                                        if (match && parseInt(match[1]) === targetEpisode) {
                                            subLinks.push({ 
                                                url: $$(el).attr('href'), 
                                                quality: getQualityFromString(t) || "Unknown" // Try to guess quality from surrounding text if possible
                                            });
                                        }
                                    });

                                    // Extract from sub-links
                                    const subPromises = subLinks.map(sl => {
                                        // Resolve redirects again for the final link
                                        return getRedirectLinks(sl.url).then(finalUrl => {
                                             return resolveExtractor(finalUrl, resolved, sl.quality);
                                        });
                                    });
                                    return Promise.all(subPromises).then(res => res.flat());
                                }).catch(() => []);
                            });
                        } else {
                            // Standard link
                            return getRedirectLinks(url).then(finalUrl => {
                                return resolveExtractor(finalUrl, pageUrl, quality);
                            });
                        }
                    });

                    return Promise.all(streamPromises).then(results => {
                        const allStreams = results.flat().filter(s => s && s.url);
                        
                        // Dedup
                        const uniqueStreams = [];
                        const seen = new Set();
                        allStreams.forEach(s => {
                            if (!seen.has(s.url)) {
                                seen.add(s.url);
                                uniqueStreams.push(s);
                            }
                        });

                        return uniqueStreams.sort((a, b) => getQualityScore(b.quality) - getQualityScore(a.quality));
                    });
                });
        });
    }).catch(err => {
        console.error("HDHub4u Global Error:", err);
        return [];
    });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
