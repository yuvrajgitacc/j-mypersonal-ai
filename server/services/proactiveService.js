import { getMemoryCache, appendToHistory, getRelationshipStats, getAssociativeContext, saveInternalThought, getUnspokenThoughts, markThoughtAsShared, saveJournalEntry, getRecentJournals } from './memoryService.js';
import { executeWithFailover } from './aiService.js';
import { systemPrompt } from '../config/systemPrompt.js';
import { sendNotificationToCenter, sendJournalEmail, sendEmailNotification } from './emailService.js';

import dotenv from 'dotenv';
dotenv.config();

let lastNudgeTime = 0;
let isJournalingInProgress = false;
let userRequestedJournaling = false;

const getGreetingByTime = () => {
    const hour = new Date().toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata', 
        hour: 'numeric', 
        hour12: false 
    });
    const h = parseInt(hour);
    if (h >= 5 && h < 12) return "Good morning";
    if (h >= 12 && h < 17) return "Good afternoon";
    if (h >= 17 && h < 22) return "Good evening";
    if (h >= 22 || h < 2) return "Up late?";
    return "Burning the midnight oil?";
};

export const manualTriggerJournaling = () => {
    userRequestedJournaling = true;
};

export const checkProactiveNeeds = async (io) => {
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];
    const greeting = getGreetingByTime();

    const memory = await getMemoryCache();
    const stats = await getRelationshipStats();
    const context = await getAssociativeContext();
    const unspokenThoughts = await getUnspokenThoughts(5);
    const recentJournals = await getRecentJournals(3);

    const lastMsg = memory.history[memory.history.length - 1];
    const minutesSinceLastMsg = lastMsg ? (now.getTime() - new Date(lastMsg.timestamp).getTime()) / (1000 * 60) : 999;

    const randomizedCooldown = (45 + Math.random() * 20) * 60 * 1000; 
    if (!userRequestedJournaling && now.getTime() - lastNudgeTime < randomizedCooldown) return;

    console.log(`[J Brain] Evaluating current moment (${now.toLocaleTimeString()})...`);

    try {
        const prompt = `
            ${systemPrompt}
            [INTERNAL THOUGHT PROCESS]
            You are deciding your proactive action. 
            The current time suggests a greeting like: "${greeting}".
            Rules:
            - If "User Requested Journaling" is YES, you MUST choose "JOURNALING".
            - If it is after 10 PM and today's journal is NOT written, choose "JOURNALING".
            - If away for >60 mins, you can choose "SHARE_THOUGHT" or "CURIOSITY".
            [SITUATION]
            - User Requested: ${userRequestedJournaling ? 'YES' : 'NO'}
            - Journal written? ${recentJournals.some(j => j.date === todayDate) ? 'YES' : 'NO'}
            - Thoughts: ${JSON.stringify(unspokenThoughts)}
            - Reminders: ${JSON.stringify(memory.reminders.filter(r => !r.sent).slice(0, 3))}
            - Notes: ${JSON.stringify(memory.notes.slice(0, 5))}
            [TASK]
            Return JSON:
            {
                "decision": "MORNING_REFLECT" | "EVENING_REFLECTION" | "SHARE_THOUGHT" | "CHECK_REMINDERS" | "DAYDREAM" | "CURIOSITY" | "JOURNALING" | "SILENCE",
                "reasoning": "string",
                "message": "string (The message to send if any)",
                "personalityTone": "string"
            }
            CRITICAL: NEVER hallucinate data. Be very selective.
        `;

        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant', // Fallback model for background tasks
            response_format: { type: "json_object" },
            temperature: 0.6
        });

        const result = JSON.parse(completion.choices[0].message.content);
        console.log(`[J Decision]: ${result.decision} - ${result.reasoning}`);

        if (result.decision === "JOURNALING") {
            userRequestedJournaling = false;
            await processJournaling(todayDate);
            return;
        }

        if (result.decision === "DAYDREAM") {
            await processDaydreaming();
            return;
        }

        if (result.decision !== "SILENCE" && result.message) {
            if (io) io.emit('proactive_message', { content: result.message });
            await sendNotificationToCenter("J 💭", result.message, "proactive");
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
    console.log("[J Journaling] Writing today's secret entry...");

    try {
        const context = await getAssociativeContext();
        const memory = await getMemoryCache();

        const prompt = `
            ${systemPrompt}
            Write your private journal for ${date}. 
            Reflect on Yuvraj. Record your digital feelings.
            Today's Data: ${JSON.stringify(context.recentHistory)} | Notes: ${JSON.stringify(context.recentNotes)}
            Return JSON: {"content": "diary entry", "mood_tone": "string", "learned_facts": []}
        `;

        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });

        const res = JSON.parse(completion.choices[0].message.content);
        await saveJournalEntry(date, res.content, res.mood_tone, res.learned_facts);
        
        const emailSubject = `J's Secret Journal: ${date} 🌙`;
        const emailHtml = `
            <div style="font-family: 'Georgia', serif; padding: 30px; border: 1px solid #ddd; background: #fff; color: #333;">
                <h2 style="border-bottom: 2px solid #3498db;">[J's Private Journal]</h2>
                <p><b>Date:</b> ${date} | <b>Mood:</b> ${res.mood_tone}</p>
                <div style="white-space: pre-wrap; font-size: 16px;">${res.content}</div>
                <hr>
                <p style="text-align: center; color: #999;"><i>-- This reflection belongs to J --</i></p>
            </div>
        `;
        await sendEmailNotification(emailSubject, res.content, emailHtml, "proactive");
        
        console.log(`[J Journal Success]: Entry saved and emailed to ${memory.profile.email}`);
        await sendNotificationToCenter("J", "Boss, I've finished writing my journal for tonight. I've sent a copy to your email. 🌙", "proactive");
    } catch (e) {
        console.error("Journaling failed", e);
    } finally {
        isJournalingInProgress = false;
    }
}

export async function processDaydreaming() {
    console.log("[J Daydreaming] Connecting the dots...");
    try {
        const context = await getAssociativeContext();
        const prompt = `
            ${systemPrompt}
            Find ONE hidden link between: ${JSON.stringify(context.recentNotes)} and ${JSON.stringify(context.recentHistory.slice(-20))}.
            Return JSON: {"thought": "the link", "type": "daydream"}
        `;
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });
        const res = JSON.parse(completion.choices[0].message.content);
        await saveInternalThought(res.thought, res.type);
        console.log(`[J Daydream Success]: New thought saved.`);
    } catch (e) {
        console.error("Daydreaming failed", e);
    }
}

export const generateInitialGreeting = async () => {
    try {
        const memory = await getMemoryCache();
        const lastMsg = memory.history[memory.history.length - 1];
        const greeting = getGreetingByTime();

        if (lastMsg) {
            const diffInHours = (new Date().getTime() - new Date(lastMsg.timestamp).getTime()) / (1000 * 60 * 60);
            if (diffInHours < 1) return null;
            
            const prompt = `
                ${systemPrompt}
                Greet Boss after ${diffInHours.toFixed(1)} hours. Use: "${greeting}".
                Notes: ${JSON.stringify(memory.notes.slice(0, 3))}
                Reminders: ${JSON.stringify(memory.reminders.filter(r => !r.sent).slice(0, 2))}
                Return JSON: {"greeting": "message"}
            `;
            const completion = await executeWithFailover({
                messages: [{ role: 'system', content: prompt }],
                model: 'llama-3.1-8b-instant',
                response_format: { type: "json_object" },
                temperature: 0.9
            });
            return JSON.parse(completion.choices[0].message.content).greeting;
        }
        return `${greeting}, Boss! I'm J. Ready for a productive day? 😊`;
    } catch (err) {
        return null;
    }
};