import axios from 'axios';

// This is the exact payload used by youtube_explode_dart mapped from Musify's Android VR setup
const androidVRPayload = {
  "context": {
    "client": {
      "clientName": "ANDROID_VR",
      "clientVersion": "1.65.10",
      "deviceModel": "Quest 3",
      "osVersion": "12L",
      "osName": "Android",
      "androidSdkVersion": "32",
      "hl": "en",
      "timeZone": "UTC",
      "utcOffsetMinutes": 0
    },
    "contextClientName": 28,
    "requireJsPlayer": false
  }
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

    // Combine payload with the video ID we want to fetch
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
            // Note: If we hit a cipher, the raw approach fails without executing JS to decipher it.
            // Using the IOS client usually bypasses the cipher and provides direct URLs.
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
