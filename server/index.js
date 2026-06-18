import express from 'express';
import cors from 'cors';
import ytSearch from 'yt-search';
import ytDlp from 'yt-dlp-exec';
import axios from 'axios';
import { getProxyForYtdlp, markProxyAsFailed } from './proxyManager.js';
import { ProxyManager } from './StandaloneProxyManager.js';
import { fetchRawStreamManifest } from './rawYoutubeClient.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(express.static('public'));

const axiosProxyManager = new ProxyManager({
   validationUrl: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
   validationTimeoutMs: 5000
});
axiosProxyManager.init().catch(console.error);

app.get('/api', (req, res) => {
  res.send('Musify Express API is running');
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Search query "q" is required' });

    const searchResults = await ytSearch(query);
    const results = searchResults.videos.slice(0, 20).map(video => ({
      ytid: video.videoId, title: video.title, artist: video.author?.name, duration: video.timestamp, thumbnail: video.thumbnail, viewCount: video.views
    }));

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to perform search' });
  }
});

// Get song details
app.get('/api/song/:ytid/details', async (req, res) => {
  try {
    const searchResult = await ytSearch({ videoId: req.params.ytid });
    res.json({
      ytid: searchResult.videoId, title: searchResult.title, artist: searchResult.author?.name, duration: searchResult.seconds, thumbnail: searchResult.thumbnail, viewCount: searchResult.views
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch song details' });
  }
});

// RAW NATIVE SPOOFED Extractor Endpoint
app.get('/api/song/:ytid/raw-stream', async (req, res) => {
  try {
    const ytid = req.params.ytid;
    let attempts = 0;
    while(attempts < 15) {
        attempts++;
        const proxiedAxios = await axiosProxyManager.getProxiedAxios();
        try {
            const streamData = await fetchRawStreamManifest(ytid, proxiedAxios);
            return res.json({ ytid: ytid, url: streamData.url, mimeType: streamData.mimeType, bitrate: streamData.bitrate });
        } catch (e) {
            console.error(`[RawStream] Attempt ${attempts} failed:`, e.message);
        }
    }
    return res.status(429).json({ error: 'Failed to fetch stream URL using Raw Spoofed API due to YouTube rate limits or bot blocks.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stream URL', details: error.message });
  }
});

// Original yt-dlp endpoint
app.get('/api/song/:ytid/stream', async (req, res) => {
  try {
    const ytid = req.params.ytid;
    let attempts = 0;
    while(attempts < 10) {
        attempts++;
        const proxyUrl = await getProxyForYtdlp();
        try {
            const options = { dumpJson: true, format: 'bestaudio' };
            if (proxyUrl) options.proxy = proxyUrl;
            const output = await ytDlp(`https://www.youtube.com/watch?v=${ytid}`, options);
            if (output && output.url) return res.json({ ytid: ytid, url: output.url, mimeType: `audio/${output.ext}`, bitrate: output.abr });
        } catch (error) {
            console.error(`Attempt ${attempts} failed with proxy ${proxyUrl}:`, error.message);
            await markProxyAsFailed(proxyUrl);
        }
    }
    return res.status(429).json({ error: 'Failed to fetch stream URL due to YouTube rate limits (429) or bot blocks.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stream URL', details: error.message });
  }
});

// VERY IMPORTANT: PROXY AUDIO STREAM ENDPOINT TO BYPASS BROWSER CORS AND IP MISMATCH (403)
app.get('/api/stream-audio', async (req, res) => {
    const { url } = req.query;
    if (!url.startsWith("https://") || !url.includes(".googlevideo.com/")) return res.status(403).send("Forbidden: Invalid stream URL");
    if (!url) return res.status(400).send('Missing url parameter');
    try {
        const response = await axios({ method: 'get', url: url, responseType: 'stream' });
        res.set({
            'Content-Type': response.headers['content-type'],
            'Content-Length': response.headers['content-length'],
            'Accept-Ranges': 'bytes'
        });
        response.data.pipe(res);
    } catch (e) {
        console.error("Failed to proxy audio stream:", e.message);
        res.status(500).send('Failed to proxy audio stream. This URL might be blocked by IP mismatch or expired.');
    }
});

// Get Playlist
app.get('/api/playlist/:playlistId', async (req, res) => {
  try {
    const playlist = await ytSearch({ listId: req.params.playlistId });
    if (!playlist || !playlist.videos) return res.status(404).json({ error: 'Playlist not found or empty' });
    res.json({
      id: playlist.listId, title: playlist.title, author: playlist.author?.name, videos: playlist.videos.map(v => ({
        ytid: v.videoId, title: v.title, artist: v.author?.name, duration: v.duration?.seconds, thumbnail: v.thumbnail
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// Get related videos
app.get('/api/song/:ytid/related', async (req, res) => {
  try {
    const searchResult = await ytSearch({ videoId: req.params.ytid });
    const searchResults = await ytSearch(searchResult.author?.name || searchResult.title);
    res.json(searchResults.videos.slice(0, 10).map(v => ({
      ytid: v.videoId, title: v.title, artist: v.author?.name, duration: v.timestamp, thumbnail: v.thumbnail, viewCount: v.views
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch related videos' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
