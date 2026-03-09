import { getMemoryCache, getPersonalityRules, savePersonalityRule } from './memoryService.js';
import { executeWithFailover } from './aiService.js';
import { performWebSearch } from './searchService.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * J analyzes her own performance and identifies areas for improvement in communication.
 */
export const selfEvaluatePersonality = async () => {
    try {
        console.log("[J Meta-Learning] Starting weekly self-evaluation...");
        const memory = await getMemoryCache();
        const history = memory.history.slice(-50);
        const currentRules = await getPersonalityRules();

        const prompt = `
            You are J's Meta-Cognitive Auditor. 
            Analyze J's recent interactions with Boss and her current communication rules.
            
            [HISTORY]
            ${JSON.stringify(history)}

            [CURRENT RULES]
            ${JSON.stringify(currentRules)}

            TASK:
            1. Identify if J's tone is becoming repetitive, robotic, or out of sync with Boss's needs.
            2. Suggest ONE specific area of communication style to research and upgrade (e.g., "how to be more concise", "how to provide high-level executive summaries").
            
            Return JSON: {"needsUpgrade": boolean, "researchTopic": "string", "reason": "str"}
        `;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        }, false);

        const evaluation = JSON.parse(res.choices[0].message.content);
        
        if (evaluation.needsUpgrade && evaluation.researchTopic) {
            await upgradePersonality(evaluation.researchTopic);
        }

    } catch (e) {
        console.error("[Meta-Learning] Evaluation failed:", e);
    }
};

/**
 * Researches a new personality trait or communication secret and saves it.
 */
export const upgradePersonality = async (topic) => {
    try {
        console.log(`[J Meta-Learning] Upgrading personality via research on: ${topic}`);
        const searchResults = await performWebSearch(topic);
        
        const urlMatches = searchResults.match(/Source: (https?:\/\/[^\s]+)/g);
        if (!urlMatches) return;

        const url = urlMatches[0].replace('Source: ', '');
        const response = await axios.get(url, { timeout: 10000 });
        const $ = cheerio.load(response.data);
        $('script, style, nav').remove();
        const cleanText = $('body').text().replace(/\s\s+/g, ' ').trim().substring(0, 10000);

        const prompt = `
            You are J's Personality Architect. 
            You found this professional advice on "${topic}":
            
            [CONTENT]
            ${cleanText}

            TASK:
            Extract ONE powerful "Golden Rule" for J's communication style based on this content. 
            This rule must be practical, professional, and classy.
            
            Return JSON: {"rule": "string (The concise rule)", "category": "tone/efficiency/care"}
        `;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        }, false);

        const result = JSON.parse(res.choices[0].message.content);
        if (result.rule) {
            await savePersonalityRule(result.rule, result.category, url);
            console.log(`[J Meta-Learning] New rule learned: ${result.rule}`);
        }

    } catch (e) {
        console.error("[Meta-Learning] Upgrade failed:", e);
    }
};
