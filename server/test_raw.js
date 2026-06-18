import { fetchRawStreamManifest } from './rawYoutubeClient.js';
import axios from 'axios';

async function test() {
    try {
        const streamData = await fetchRawStreamManifest('YQHsXMglC9A', axios);
        console.log("Success:", !!streamData.url);
    } catch (e) {
        console.log("Error:", e.message);
    }
}
test();
