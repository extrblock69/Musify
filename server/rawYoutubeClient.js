import axios from 'axios';

// TVHTML5 Payload to bypass age-restrictions and severe bot blocks
const tvHtml5Payload = {
    "context": {
      "client": {
        "clientName": "TVHTML5",
        "clientVersion": "7.20251105.10.00",
        "deviceMake": "",
        "deviceModel": "",
        "userAgent": "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version,gzip(gfe)",
        "hl": "en",
        "timeZone": "UTC",
        "gl": "US",
        "utcOffsetMinutes": 0,
        "originalUrl": "https://www.youtube.com/tv",
        "theme": "CLASSIC",
        "platform": "DESKTOP",
        "clientFormFactor": "UNKNOWN_FORM_FACTOR",
        "webpSupport": false,
        "tvAppInfo": {"appQuality": "TV_APP_QUALITY_FULL_ANIMATION"},
        "acceptHeader": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      "user": {"lockedSafetyMode": false},
      "request": {"useSsl": true}
    },
    "contentCheckOk": true,
    "racyCheckOk": true
};

const iosPayload = {
    "context": {
      "client": {
        "clientName": "IOS",
        "clientVersion": "20.10.4",
        "deviceMake": "Apple",
        "deviceModel": "iPhone16,2",
        "userAgent": "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
        "hl": "en",
        "platform": "MOBILE",
        "osName": "IOS",
        "osVersion": "18.1.0.22B83",
        "timeZone": "UTC",
        "gl": "US",
        "utcOffsetMinutes": 0
      }
    }
};

/**
 * Makes a raw spoofed POST request to YouTube's internal player API.
 * Optionally uses a proxied Axios client if provided.
 */
export async function fetchRawStreamManifest(videoId, proxiedAxiosClient = axios) {
    const url = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

    // Combine payload with the video ID we want to fetch. Fallback to IOS if TV fails.
    const payload = {
        ...iosPayload,
        videoId: videoId
    };

    const headers = {
        'content-type': 'application/json',
        'user-agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
        'cookie': 'CONSENT=YES+cb'
    };

    try {
        const response = await proxiedAxiosClient.post(url, payload, { headers, timeout: 10000 });
        const data = response.data;

        if (data.playabilityStatus && data.playabilityStatus.status === 'ERROR') {
             throw new Error(`YouTube Playability Error: ${data.playabilityStatus.reason}`);
        }

        if (data.playabilityStatus && data.playabilityStatus.status === 'LOGIN_REQUIRED') {
             throw new Error('Sign in to confirm you’re not a bot');
        }

        if (!data.streamingData) {
            throw new Error('No streamingData found in the response manifest.');
        }

        const formats = [
            ...(data.streamingData.formats || []),
            ...(data.streamingData.adaptiveFormats || [])
        ];

        // Filter for audio-only formats
        const audioFormats = formats.filter(f => f.mimeType && f.mimeType.startsWith('audio/'));

        if (audioFormats.length === 0) {
            throw new Error('No audio formats found in manifest.');
        }

        // Sort by bitrate to get the highest quality
        audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        const bestAudio = audioFormats[0];

        if (!bestAudio.url && bestAudio.signatureCipher) {
            throw new Error('Stream requires signature deciphering, which is not supported in the raw client. Try another proxy or wait.');
        }

        return {
            url: bestAudio.url,
            mimeType: bestAudio.mimeType,
            bitrate: bestAudio.bitrate
        };

    } catch (e) {
        if (e.response && e.response.status === 429) {
             throw new Error('429 Too Many Requests');
        }
        throw e;
    }
}
