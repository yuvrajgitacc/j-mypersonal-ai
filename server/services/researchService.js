import axios from 'axios';
import * as cheerio from 'cheerio';
import { performWebSearch } from './searchService.js';
import { executeWithFailover } from './aiService.js';
import { saveLongTermFact } from './memoryService.js';

/**
 * Scrapes the raw text content from a URL.
 */
const scrapeUrl = async (url) => {
    try {
        console.log(`[J Researcher] Scaping: ${url}...`);
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        // Remove scripts, styles, and nav elements to get clean text
        $('script, style, nav, header, footer, noscript').remove();
        
        const cleanText = $('body').text().replace(/\s\s+/g, ' ').trim();
        return cleanText.substring(0, 15000); // Limit to first 15k chars
    } catch (error) {
        console.error(`[J Researcher] Scrape failed for ${url}:`, error.message);
        return null;
    }
};

/**
 * Researches a topic, scrapes top results, and distills "Master Knowledge".
 */
export const researchTopic = async (topic) => {
    console.log(`[J Researcher] Starting deep research on: ${topic}`);
    
    try {
        // 1. Search for the topic
        const searchResults = await performWebSearch(`${topic} documentation and best practices`);
        
        // Extract URLs using regex from the search results string
        const urlMatches = searchResults.match(/Source: (https?:\/\/[^\s]+)/g);
        if (!urlMatches) return { success: false, reason: "No URLs found to research." };

        const urls = urlMatches.map(m => m.replace('Source: ', '')).slice(0, 3); // Take top 3 links
        let collectiveKnowledge = "";

        // 2. Scrape each URL
        for (const url of urls) {
            const text = await scrapeUrl(url);
            if (text) collectiveKnowledge += `\n--- Data from ${url} ---\n${text}\n`;
        }

        if (!collectiveKnowledge) return { success: false, reason: "Could not extract any content from URLs." };

        // 3. Distill Master Knowledge using AI
        console.log(`[J Researcher] Distilling collective knowledge for: ${topic}...`);
        const prompt = `
            You are J's Autonomous Research Module. 
            You have scraped the following raw data about the topic: "${topic}".
            
            [RAW DATA]
            ${collectiveKnowledge.substring(0, 20000)}

            TASK:
            1. Analyze the raw data and extract high-level "Master Knowledge".
            2. Identify core concepts, critical rules, and expert-level insights.
            3. Ignore ads, menu items, or irrelevant website fluff.
            4. Format the output as a set of concise, powerful "Long-Term Facts" that will make J an expert on this topic.

            Return JSON:
            {
                "topic": "${topic}",
                "master_summary": "A high-level overview of your mastery",
                "key_facts": [
                    {"fact": "string", "category": "str"}
                ]
            }
        `;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant', // Fast distillation
            response_format: { type: "json_object" },
            temperature: 0.1
        }, false);

        const mastery = JSON.parse(res.choices[0].message.content);

        // 4. Save to Memory
        for (const kf of mastery.key_facts) {
            await saveLongTermFact(kf.fact, kf.category || `mastery_${topic}`, 3); // Importance 3 for master knowledge
        }

        console.log(`[J Researcher] Mastery achieved for: ${topic}. Saved ${mastery.key_facts.length} core facts.`);
        return { success: true, summary: mastery.master_summary };

    } catch (error) {
        console.error("[J Researcher] Research loop failed:", error);
        return { success: false, reason: error.message };
    }
};

/**
 * Scans recent chat history to find "Gaps" in knowledge that need research.
 */
export const identifyResearchNeeds = async (history) => {
    try {
        const prompt = `
            Analyze the recent conversation between Boss and J. 
            Identify if there are any specific technical topics, project tools, or professional skills where J lacked deep knowledge or where Boss expressed interest.
            
            [HISTORY]
            ${JSON.stringify(history.slice(-10))}

            Return JSON: {"needsResearch": boolean, "topic": "string (optimized search query)", "reason": "str"}
        `;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        }, false);

        return JSON.parse(res.choices[0].message.content);
    } catch (e) {
        return { needsResearch: false };
    }
};
