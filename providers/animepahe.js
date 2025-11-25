/**
 * AnimePahe Scraper for Nuvio (Advanced)
 * Integrates TMDB and Kitsu for accurate season mapping.
 */

const BASE_URL = "https://animepahe.si";
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Cookie': '__ddg2_=1234567890',
    'Referer': BASE_URL
};

// --- APIs Configuration ---
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // Use a valid key
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const KITSU_BASE_URL = 'https://kitsu.io/api/edge';
const KITSU_HEADERS = {
    'Accept': 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json'
};

// --- Helper Functions ---

function fetchRequest(url, options) {
    const merged = Object.assign({ method: 'GET', headers: HEADERS }, options || {});
    return fetch(url, merged).then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
    });
}

function fetchJson(url, options) {
    return fetchRequest(url, options).then(res => res.json());
}

function fetchText(url, options) {
    return fetchRequest(url, options).then(res => res.text());
}

// --- Metadata Logic (TMDB + Kitsu) ---

// 1. Get Title and Season Info from TMDB
function getTMDBDetails(tmdbId, mediaType, seasonNumber) {
    if (!tmdbId) return Promise.resolve(null);
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;

    return fetch(url).then(res => res.json())
        .then(data => {
            const baseTitle = mediaType === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title);
            const year = (data.first_air_date || data.release_date || '').split('-')[0];
            
            // If it's a TV show, get specific season name (helps with Anime "Arcs")
            if (mediaType === 'tv' && seasonNumber > 1) {
                const seasonUrl = `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`;
                return fetch(seasonUrl).then(res => res.json()).then(sData => {
                    return {
                        title: baseTitle,
                        year: year,
                        seasonName: sData.name, // e.g., "Entertainment District Arc"
                        isMultiSeason: true
                    };
                }).catch(() => ({ title: baseTitle, year: year, isMultiSeason: true }));
            }
            
            return { title: baseTitle, year: year, isMultiSeason: false };
        })
        .catch(() => null);
}

// 2. Search Kitsu for the "Anime Season" entry
function searchKitsu(query) {
    const url = `${KITSU_BASE_URL}/anime?filter[text]=${encodeURIComponent(query)}`;
    return fetchJson(url, { headers: KITSU_HEADERS }).then(json => {
        if (!json.data || json.data.length === 0) return null;
        // Return the first/best match title
        const attr = json.data[0].attributes;
        return attr.titles.en || attr.titles.en_jp || attr.canonicalTitle;
    });
}

// 3. Resolve best search query
function getAccurateTitle(input) {
    const tmdbId = input.tmdbId;
    const season = input.season || 1;
    const type = input.type;
    
    // Step A: TMDB Lookup
    return getTMDBDetails(tmdbId, type, season).then(metadata => {
        let candidateTitle = input.title;
        
        if (metadata) {
            candidateTitle = metadata.title;
            // If TMDB has a specific season name (like "Season 2" or "Arc Name")
            if (metadata.isMultiSeason && season > 1) {
                // Try searching "Title Season N" first
                candidateTitle += ` Season ${season}`; 
            }
        }

        // Step B: Kitsu Correction (Optional but recommended for Anime)
        // We search Kitsu with our candidate title to see if there is a specific entry
        return searchKitsu(candidateTitle).then(kitsuTitle => {
            if (kitsuTitle) {
                return kitsuTitle; // Use Kitsu's official English title
            }
            return candidateTitle; // Fallback to TMDB constructed title
        });
    });
}

// --- AnimePahe Logic ---

function searchAnimePahe(query) {
    const url = `${BASE_URL}/api?m=search&l=8&q=${encodeURIComponent(query)}`;
    return fetchJson(url).then(json => {
        if (!json || !json.data || json.data.length === 0) return null;
        return json.data[0]; 
    });
}

function getEpisodeSession(animeSession, targetEpisode) {
    const perPage = 30;
    const page = Math.ceil(targetEpisode / perPage);
    const url = `${BASE_URL}/api?m=release&id=${animeSession}&sort=episode_asc&page=${page}`;
    
    return fetchJson(url).then(json => {
        if (!json || !json.data) return null;
        for (let i = 0; i < json.data.length; i++) {
            if (json.data[i].episode === targetEpisode) {
                return json.data[i].session;
            }
        }
        return null;
    });
}

function extractKwik(kwikUrl) {
    return fetchText(kwikUrl, { headers: { "Referer": BASE_URL } }).then(html => {
        const regex = /source=\s*['"](.*?.m3u8.*?)['"]/;
        const match = html.match(regex);
        if (match && match[1]) return match[1];
        
        const backupRegex = /(https?:\/\/[^"']+\.m3u8[^"']*)/;
        const backupMatch = html.match(backupRegex);
        if (backupMatch && backupMatch[1]) return backupMatch[1];

        return null;
    });
}

// --- Main Export ---

function getStreams(input) {
    const episode = input.episode || 1;

    // Pipeline: TMDB -> Kitsu -> AnimePahe
    return getAccurateTitle(input).then(searchQuery => {
        // console.log("Searching AnimePahe for:", searchQuery); 
        return searchAnimePahe(searchQuery);
    }).then(animeData => {
        if (!animeData) throw new Error('Anime not found');
        return getEpisodeSession(animeData.session, episode).then(epSession => {
            return { animeSession: animeData.session, epSession: epSession };
        });
    }).then(data => {
        if (!data.epSession) throw new Error('Episode not found');
        const playUrl = `${BASE_URL}/play/${data.animeSession}/${data.epSession}`;
        
        return fetchText(playUrl).then(html => {
            const streams = [];
            const buttonRegex = /<button[^>]+data-src="([^"]+)"[^>]+data-audio="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
            let match;
            const promises = [];

            while ((match = buttonRegex.exec(html)) !== null) {
                const url = match[1];
                const audio = match[2]; 
                const content = match[3];

                if (url.indexOf('kwik') === -1) continue;

                const resMatch = content.match(/(\d{3,4}p)/);
                const quality = resMatch ? resMatch[1] : 'Unknown';
                const isDub = audio === 'eng' || content.toLowerCase().includes('eng');
                
                const p = extractKwik(url).then(m3u8 => {
                    if (m3u8) {
                        return {
                            name: `AnimePahe ${quality}${isDub ? ' [Dub]' : ' [Sub]'}`,
                            title: input.title,
                            url: m3u8,
                            behaviorHints: {
                                bingeGroup: `AnimePahe-${isDub ? "Dub" : "Sub"}`,
                                notWebReady: false
                            }
                        };
                    }
                    return null;
                });
                promises.push(p);
            }
            return Promise.all(promises);
        });
    }).then(results => {
        return results.filter(s => s !== null);
    }).catch(err => {
        console.error("Scraper Error:", err);
        return [];
    });
}

module.exports = { getStreams };
