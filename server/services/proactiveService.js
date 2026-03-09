import { getMemoryCache, appendToHistory, getRelationshipStats, getAssociativeContext, saveInternalThought, getUnspokenThoughts, saveJournalEntry, getRecentJournals } from './memoryService.js';
import { executeWithFailover } from './aiService.js';
import { systemPrompt } from '../config/systemPrompt.js';
import { sendNotificationToCenter, sendJournalEmail, sendEmailNotification } from './emailService.js';
import dotenv from 'dotenv';

dotenv.config();

let lastNudgeTime = 0;
let isJournalingInProgress = false;
let userRequestedJournaling = false;

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
        const prompt = `
            ${systemPrompt}
            Analyze current situation. Do you need to share a thought or start journaling?
            Rules:
            - If Journaling is requested or it is late night, choose JOURNALING.
            - If something is actually relevant to past notes, choose SHARE_THOUGHT.
            - Otherwise, choose SILENCE.
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
        const context = await getAssociativeContext();
        const prompt = `Write J's private journal for ${date}. JSON: {"content": "...", "mood_tone": "..."}`;
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });
        const res = JSON.parse(completion.choices[0].message.content);
        await saveJournalEntry(date, res.content, res.mood_tone, []);
    } catch (e) { console.error("Journaling failed", e); }
    finally { isJournalingInProgress = false; }
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
