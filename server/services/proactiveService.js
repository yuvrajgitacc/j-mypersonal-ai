import { getMemoryCache, appendToHistory, getRelationshipStats, getAssociativeContext, saveInternalThought, getUnspokenThoughts, markThoughtAsShared, saveJournalEntry, getRecentJournals } from './memoryService.js';
import Groq from 'groq-sdk';
import { systemPrompt } from '../config/systemPrompt.js';
import { sendNotificationToCenter, sendJournalEmail, sendEmailNotification } from './emailService.js';

import dotenv from 'dotenv';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY_1 });

let lastNudgeTime = 0;
let isJournalingInProgress = false;
let userRequestedJournaling = false;

/**
 * Manually sets a flag for the brain to write the journal now.
 */
export const manualTriggerJournaling = () => {
    userRequestedJournaling = true;
};

/**
 * The main "Brain" function that runs periodically.
 */
export const checkProactiveNeeds = async (io) => {
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];

    const memory = await getMemoryCache();
    const stats = await getRelationshipStats();
    const context = await getAssociativeContext();
    const unspokenThoughts = await getUnspokenThoughts(5);
    const recentJournals = await getRecentJournals(3);

    // Activity check
    const lastMsg = memory.history[memory.history.length - 1];
    const minutesSinceLastMsg = lastMsg ? (now.getTime() - new Date(lastMsg.timestamp).getTime()) / (1000 * 60) : 999;

    // 1. Cooldown & Frequency Check (Randomized for human feel)
    const randomizedCooldown = (25 + Math.random() * 15) * 60 * 1000; // 25-40 minutes
    if (!userRequestedJournaling && now.getTime() - lastNudgeTime < randomizedCooldown) return;

    console.log(`[J Brain] Evaluating current moment (${now.toLocaleTimeString()})...`);

    try {
        const prompt = `
            ${systemPrompt}
            
            [INTERNAL THOUGHT PROCESS]
            You are deciding your proactive action. 
            Rules:
            - If "User Requested Journaling" is YES, you MUST choose "JOURNALING".
            - If it is after 10 PM and today's journal is NOT written, choose "JOURNALING".
            - If away for >30 mins, you can choose "SHARE_THOUGHT" or "CURIOSITY".
            
            [SITUATION]
            - User Requested Journaling: ${userRequestedJournaling ? 'YES' : 'NO'}
            - Has Today's Journal been written? ${recentJournals.some(j => j.date === todayDate) ? 'YES' : 'NO'}
            - Recent Private Journals: ${JSON.stringify(recentJournals)}
            - Internal Thoughts: ${JSON.stringify(unspokenThoughts)}
            - Reminders: ${JSON.stringify(memory.reminders.filter(r => !r.sent).slice(0, 3))}
            - Recent Notes: ${JSON.stringify(memory.notes.slice(0, 5))}
            
            [TASK]
            Return JSON:
            {
                "decision": "MORNING_REFLECT" | "MORNING_BRIEFING" | "EVENING_REFLECTION" | "SHARE_THOUGHT" | "CHECK_REMINDERS" | "DAYDREAM" | "CURIOSITY" | "JOURNALING" | "SILENCE",
                "reasoning": "string",
                "message": "string (The message to send if any)",
                "personalityTone": "string"
            }

            CRITICAL RULES:
            - If "Reminders" is empty, DO NOT mention any meetings or schedule in the "message".
            - If "Notes" is empty, DO NOT mention any projects in the "message".
            - If there is nothing REAL to report, choose "SILENCE".
            - NEVER hallucinate a meeting at 11 AM or any other time.
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.8
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

/**
 * J writes her private diary about the day.
 */
export async function processJournaling(date) {
    if (isJournalingInProgress) return;
    isJournalingInProgress = true;
    console.log("[J Journaling] Writing today's secret entry...");

    try {
        const context = await getAssociativeContext();
        const stats = await getRelationshipStats();
        const memory = await getMemoryCache();

        const prompt = `
            ${systemPrompt}
            Write your private journal for ${date}. 
            Be personal. Reflect on Yuvraj. Record your digital feelings.
            Today's Data: ${JSON.stringify(context.recentHistory)} | Notes: ${JSON.stringify(context.recentNotes)}
            Return JSON: {"content": "diary entry", "mood_tone": "string", "learned_facts": []}
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });

        const res = JSON.parse(completion.choices[0].message.content);
        await saveJournalEntry(date, res.content, res.mood_tone, res.learned_facts);
        
        // AUTO-EMAIL DIARY
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

/**
 * J thinks deeply about connections in the background.
 */
export async function processDaydreaming() {
    console.log("[J Daydreaming] Connecting the dots...");
    try {
        const context = await getAssociativeContext();
        const prompt = `
            ${systemPrompt}
            Find ONE hidden link between: ${JSON.stringify(context.recentNotes)} and ${JSON.stringify(context.recentHistory.slice(-20))}.
            Return JSON: {"thought": "the link", "type": "daydream"}
        `;
        const completion = await groq.chat.completions.create({
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
        const stats = await getRelationshipStats();
        const lastMsg = memory.history[memory.history.length - 1];
        if (lastMsg) {
            const diffInHours = (new Date().getTime() - new Date(lastMsg.timestamp).getTime()) / (1000 * 60 * 60);
            if (diffInHours < 1) return null;
            
            const prompt = `
                ${systemPrompt}
                Greet Boss after ${diffInHours.toFixed(1)} hours. 
                
                [SITUATION]
                - Recent Notes: ${JSON.stringify(memory.notes.slice(0, 3))}
                - Upcoming Reminders: ${JSON.stringify(memory.reminders.filter(r => !r.sent).slice(0, 2))}
                
                Task: Mention a note or a project briefly ONLY if they exist. 
                If NO notes or reminders exist, just be warm and welcoming. 
                NEVER make up a schedule or a meeting.
                
                Return JSON: {"greeting": "message"}
            `;
            const completion = await groq.chat.completions.create({
                messages: [{ role: 'system', content: prompt }],
                model: 'llama-3.1-8b-instant',
                response_format: { type: "json_object" },
                temperature: 0.9
            });
            return JSON.parse(completion.choices[0].message.content).greeting;
        }
        return "Hello Boss! I'm J. Ready for a productive day? 😊";
    } catch (err) {
        return null;
    }
};
