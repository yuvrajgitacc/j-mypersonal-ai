import { getMemoryCache, appendToHistory, getRelationshipStats, getAssociativeContext, saveInternalThought, getUnspokenThoughts, saveJournalEntry, getRecentJournals } from './memoryService.js';
import { executeWithFailover } from './aiService.js';
import { systemPrompt } from '../config/systemPrompt.js';
import { sendNotificationToCenter, sendJournalEmail, sendEmailNotification } from './emailService.js';
import { selfEvaluatePersonality } from './metaLearningService.js';
import dotenv from 'dotenv';

dotenv.config();

let lastNudgeTime = 0;
let isJournalingInProgress = false;
let userRequestedJournaling = false;

/**
 * Weekly Personality Upgrade Trigger
 */
export const runWeeklySelfEvaluation = async () => {
    await selfEvaluatePersonality();
};

export const manualTriggerJournaling = () => {
    userRequestedJournaling = true;
};

/**
 * Clean Proactive Brain - ONLY talks if something is actually important.
 */
export const checkProactiveNeeds = async (io) => {
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];

    const memory = await getMemoryCache();
    const unspokenThoughts = await getUnspokenThoughts(5);
    const recentJournals = await getRecentJournals(3);

    // Increase cooldown to avoid being annoying (1 hour)
    const cooldown = 60 * 60 * 1000;
    if (!userRequestedJournaling && now.getTime() - lastNudgeTime < cooldown) return;

    try {
        const hour = new Date().getHours();
        const isLateNight = hour >= 22 || hour < 2;
        const journalAlreadyWritten = recentJournals.some(j => j.date === todayDate);

        const prompt = `
            ${systemPrompt}
            [SITUATION]
            - Current Hour: ${hour}
            - Journal Already Written? ${journalAlreadyWritten ? 'YES' : 'NO'}
            - User Requested Journaling? ${userRequestedJournaling ? 'YES' : 'NO'}
            - Recent Interactions: ${JSON.stringify(memory.history.slice(-5))}

            [RULES]
            1. If "User Requested Journaling" is YES, you MUST choose "JOURNALING".
            2. If it is after 10 PM (Hour >= 22) and Journal is NOT written, you MUST choose "JOURNALING".
            3. Otherwise, if you have a meaningful thought based on notes or history, choose "SHARE_THOUGHT".
            4. Otherwise, choose "SILENCE".

            Return JSON: {"decision": "SILENCE" | "SHARE_THOUGHT" | "JOURNALING", "message": "str", "reasoning": "str"}
        `;

        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.6
        });

        const result = JSON.parse(completion.choices[0].message.content);

        if (result.decision === "JOURNALING") {
            userRequestedJournaling = false;
            await processJournaling(todayDate);
            return;
        }

        if (result.decision === "SHARE_THOUGHT" && result.message) {
            if (io) io.emit('proactive_message', { content: result.message });
            await appendToHistory('assistant', result.message);
            lastNudgeTime = now.getTime();
        }
    } catch (err) {
        console.error("Proactive Brain Error:", err);
    }
};

export async function processJournaling(date) {
    if (isJournalingInProgress) return;
    isJournalingInProgress = true;
    try {
        console.log(`[J Journaling] Writing entry for ${date}...`);
        const context = await getAssociativeContext();
        const prompt = `Write J's private journal for ${date}. Reflect on Yuvraj and today's interactions: ${JSON.stringify(context.recentHistory)}. Return JSON: {"content": "...", "mood_tone": "..."}`;
        
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });
        
        const res = JSON.parse(completion.choices[0].message.content);
        await saveJournalEntry(date, res.content, res.mood_tone, []);
        
        // AUTO-EMAIL AFTER WRITING
        await sendJournalEmail(date, res.content, res.mood_tone);
        console.log(`[J Journaling] Success and emailed.`);
        
    } catch (e) { 
        console.error("Journaling failed", e); 
    } finally { 
        isJournalingInProgress = false; 
    }
}

export const generateInitialGreeting = async () => {
    try {
        const memory = await getMemoryCache();
        const lastMsg = memory.history[memory.history.length - 1];
        if (lastMsg) {
            const diffInHours = (new Date().getTime() - new Date(lastMsg.timestamp).getTime()) / (1000 * 60 * 60);
            if (diffInHours < 2) return null;
        }
        return "I'm back, Boss. Ready whenever you are. 😊";
    } catch (err) { return null; }
};
