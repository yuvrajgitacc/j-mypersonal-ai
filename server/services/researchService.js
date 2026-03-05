import axios from 'axios';
import * as cheerio from 'cheerio';
import { YoutubeTranscript } from 'youtube-transcript';

/**
 * Extracts the main text content from a general article URL.
 */
export const fetchArticleContent = async (url) => {
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 5000
        });
        const $ = cheerio.load(data);
        
        // Remove scripts, styles, and nav elements to get clean text
        $('script, style, nav, footer, header, aside').remove();
        
        const title = $('title').text() || $('h1').first().text();
        const content = $('p').map((i, el) => $(el).text()).get().join('\n');

        return {
            title,
            content: content.substring(0, 15000) // Limit for AI context
        };
    } catch (err) {
        console.error("Article fetch error:", err);
        return null;
    }
};

/**
 * Fetches the transcript from a YouTube video URL.
 */
export const fetchYouTubeTranscript = async (url) => {
    try {
        const videoId = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
        if (!videoId) return null;

        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        return transcript.map(t => t.text).join(' ');
    } catch (err) {
        console.error("YouTube transcript fetch error:", err);
        return null;
    }
};

/**
 * Detects if a message contains a URL and returns the content for summarization.
 */
export const processLinkForResearch = async (userMessage) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const match = userMessage.match(urlRegex);
    if (!match) return null;

    const url = match[0];
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        console.log("Researching YouTube video:", url);
        const transcript = await fetchYouTubeTranscript(url);
        return { type: 'youtube', content: transcript, url };
    } else {
        console.log("Researching article:", url);
        const article = await fetchArticleContent(url);
        return { type: 'article', content: article?.content, title: article?.title, url };
    }
};
