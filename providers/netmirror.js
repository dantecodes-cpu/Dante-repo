if (platform.toLowerCase() === "primevideo") {
    // PrimeVideo specific URL handling
    if (!fullUrl.includes("pv/hls/")) {
        // If it has /tv/pv/hls/, remove the /tv/
        if (fullUrl.includes("/tv/pv/hls/")) {
            fullUrl = fullUrl.replace("/tv/pv/hls/", "/pv/hls/");
        } 
        // Extract any m3u8 filename
        else {
            const m3u8Match = fullUrl.match(/\/([A-Z0-9]+\.m3u8.*)$/);
            if (m3u8Match) {
                fullUrl = `/pv/hls/${m3u8Match[1]}`;
            }
        }
    }
    // Remove /tv/ if present
    fullUrl = fullUrl.replace("/tv/", "/");
}
