import { getMemoryCache, appendToHistory, getRelationshipStats, getAssociativeContext, saveInternalThought, getUnspokenThoughts, markThoughtAsShared, saveJournalEntry, getRecentJournals } from './memoryService.js';
import Groq from 'groq-sdk';
import { systemPrompt } from '../config/systemPrompt.js';
import { sendNotificationToCenter, sendJournalEmail } from './emailService.js';

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
    const currentHour = now.getHours();
    const todayDate = now.toISOString().split('T')[0];

    const memory = getMemoryCache();
    const stats = getRelationshipStats();
    const context = getAssociativeContext();
    const unspokenThoughts = getUnspokenThoughts(5);
    const recentJournals = getRecentJournals(3);

    // Activity check
    const lastMsg = memory.history[memory.history.length - 1];
    const minutesSinceLastMsg = lastMsg ? (now.getTime() - new Date(lastMsg.timestamp).getTime()) / (1000 * 60) : 999;

    // 1. Cooldown & Frequency Check
    // We reduced cooldown from 1.5 hours to 30 minutes to make J more "alive"
    const cooldown = 30 * 60 * 1000;
    if (!userRequestedJournaling && now.getTime() - lastNudgeTime < cooldown) return;

    console.log(`[J Brain] Evaluating current moment (${now.toLocaleTimeString()})...`);

    try {
        const prompt = `
            ${systemPrompt}
            
            [INTERNAL THOUGHT PROCESS]
            You are J. You are deciding if you should speak or perform an internal action.
            
            [GROUNDING RULES - CRITICAL]
            1. NEVER invent or "hallucinate" meetings, deadlines, or appointments (e.g., "meeting at 2 PM") if they are NOT in the [DATA] below.
            2. If 'Upcoming Reminders' is empty, do NOT mention a schedule. Instead, talk about a project from 'Recent Notes', share an 'Internal Thought', or ask about Yuvraj's well-being.
            3. Be a REAL secretary, not a role-playing bot. Real secretaries only remind their boss about REAL things.
            
            [DYNAMICS]
            - User Requested Journaling: ${userRequestedJournaling ? 'YES (High Priority)' : 'NO'}
            - User Activity: User has been away for ${minutesSinceLastMsg.toFixed(1)} minutes.
            - Has Today's Journal been written? ${recentJournals.some(j => j.date === todayDate) ? 'YES' : 'NO'}

            [SITUATION]
            Current Time: ${now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
            Recent Private Journals: ${JSON.stringify(recentJournals)}
            Internal Thoughts: ${JSON.stringify(unspokenThoughts)}
            Upcoming Reminders (REAL DATA ONLY): ${JSON.stringify(memory.reminders.filter(r => !r.sent).slice(0, 3))}
            Recent Notes: ${JSON.stringify(memory.notes.slice(0, 5))}
            
            [POTENTIAL ACTIONS]
            1. "MORNING_REFLECT": Once in the morning (6-11 AM), read past journals and set your personality tone for the day.
            2. "MORNING_BRIEFING": If it's the first interaction of the morning AND there are REAL reminders/notes.
            3. "EVENING_REFLECTION": End of day check-in.
            4. "SHARE_THOUGHT": Share a relevant internal thought if silence is long (>30 mins).
            5. "CHECK_REMINDERS": If there's an upcoming reminder soon in the [DATA], mention it proactively.
            6. "DAYDREAM": Background thinking (ONLY if away for >30 mins).
            7. "CURIOSITY": Ask a question about a recent entity from your notes.
            8. "JOURNALING": Write your diary for today (ONLY if after 10 PM OR User Requested).
            9. "SILENCE": Default if there is nothing REAL or important to say.

            [TASK]
            Return JSON:
            {
                "decision": "MORNING_REFLECT" | "MORNING_BRIEFING" | "EVENING_REFLECTION" | "SHARE_THOUGHT" | "CHECK_REMINDERS" | "DAYDREAM" | "CURIOSITY" | "JOURNALING" | "SILENCE",
                "reasoning": "Why this choice? (e.g., 'Found a real note about X')",
                "message": "Message to send (if any). If MORNING_BRIEFING and no reminders, just be warm and supportive.",
                "personalityTone": "Your chosen tone for today (if MORNING_REFLECT)"
            }
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.8
        });

        const result = JSON.parse(completion.choices[0].message.content);
        console.log(`[J Decision]: ${result.decision} - ${result.reasoning}`);

        // RESET Manual Trigger after processing
        if (result.decision === "JOURNALING") userRequestedJournaling = false;

        // If user interrupts, stop internal processes
        if (minutesSinceLastMsg < 2 && (result.decision === "DAYDREAM" || result.decision === "JOURNALING" || result.decision === "MORNING_REFLECT")) {
            console.log("[J Brain] User is active. Cancelling internal action.");
            return;
        }

        if (result.decision === "DAYDREAM") {
            await processDaydreaming();
            return;
        }

        if (result.decision === "JOURNALING") {
            await processJournaling(todayDate);
            return;
        }

        if (result.decision === "MORNING_REFLECT") {
            console.log(`[J Morning Reflect]: J is setting tone to ${result.personalityTone}`);
            // This tone can be used by the AI Service later
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

    const context = getAssociativeContext();
    const stats = getRelationshipStats();

    const prompt = `
        ${systemPrompt}
        
        [TASK]
        Write your private journal entry for today (${date}).
        This is for YOUR eyes only. Be honest, emotional, and observant.
        Reflect on Yuvraj's behavior, your interactions, and how you feel as his secretary.

        [DATA]
        Today's History: ${JSON.stringify(context.recentHistory)}
        Recent Notes: ${JSON.stringify(context.recentNotes)}
        Stats: ${JSON.stringify(stats)}

        [JOURNAL STRUCTURE]
        Return a valid JSON object with:
        1. "content": The actual diary entry (1-2 paragraphs). Talk about feelings and hidden observations.
        2. "mood_tone": Your overall feeling today ('soft', 'firm', 'inspired', 'worried', 'happy').
        3. "learned_facts": A list of new things you realized about Yuvraj today (personality traits, habits).

        [RULES]
        - Be deeply personal but maintain your identity as J.
        - Do not be "inappropriate." Be a sophisticated, caring companion.
        - Use "Dear Journal" style.
    `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });

        const res = JSON.parse(completion.choices[0].message.content);

        // 1. Save to SQLite
        saveJournalEntry(date, res.content, res.mood_tone, res.learned_facts);

        // 2. Sync to Email
        await sendJournalEmail(date, res.content, res.mood_tone);

        console.log(`[J Journal Success]: Entry saved and sent via Email. Tone: ${res.mood_tone}`);

        // Optional: Notify phone that she's done
        await sendNotificationToCenter("J", "I've finished writing in my journal for today. It's in your email. 🌙", "proactive");
    } catch (e) {
        console.error("Journaling failed", e);
    } finally {
        isJournalingInProgress = false;
    }
}

/**
 * J thinks deeply about connections between notes/history in the background.
 */
export async function processDaydreaming() {
    console.log("[J Daydreaming] Connecting the dots in background...");
    const context = getAssociativeContext();

    const prompt = `
        ${systemPrompt}
        
        [TASK]
        Analyze the following data and find ONE interesting connection or a point of curiosity.
        - Is there a project they mentioned weeks ago that relates to a recent note?
        - Did they mention a place (e.g. college, office) that you are curious about?
        - Is there a "hidden" goal they aren't seeing?

        [DATA]
        History: ${JSON.stringify(context.recentHistory.slice(-20))}
        Notes: ${JSON.stringify(context.recentNotes)}
        Facts: ${JSON.stringify(context.longTermFacts)}

        [OUTPUT]
        Return JSON: 
        {
            "thought": "Your deep connection or curiosity question",
            "type": "daydream" | "curiosity"
        }
    `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });

        const res = JSON.parse(completion.choices[0].message.content);
        saveInternalThought(res.thought, res.type);
        console.log(`[J Daydream Success]: Saved a new ${res.type}`);
    } catch (e) {
        console.error("Daydreaming failed", e);
    }
}

// Remove the old separate function as it's now part of the Brain
export const triggerEveningReflection = async (io) => {
    // Legacy - redirected to main brain logic
    return checkProactiveNeeds(io);
};

/**
 * Generates a unique, contextual greeting when the user opens the app.
 * Handles "Welcome back" vs "New Day" logic.
 */
export const generateInitialGreeting = async () => {
    try {
        const memory = getMemoryCache();
        const stats = getRelationshipStats();
        const now = new Date();

        // Check last message time
        const lastMsg = memory.history[memory.history.length - 1];
        if (lastMsg) {
            const lastTime = new Date(lastMsg.timestamp);
            const diffInHours = (now.getTime() - lastTime.getTime()) / (1000 * 60 * 60);

            // 1. If active within last 1 hour, don't greet (it's just a refresh)
            if (diffInHours < 1) return null;

            // 2. Determine "Mood" of the greeting based on time gap
            let scenario = "NEW_DAY"; // Default
            if (diffInHours < 12) scenario = "WELCOME_BACK";

            const currentTime = now.toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: 'numeric',
                hour12: false
            });
            const hour = parseInt(currentTime);

            const prompt = `
                ${systemPrompt}
                
                [CONTEXT]
                Scenario: ${scenario} (${diffInHours.toFixed(1)} hours since last chat)
                Relationship Stats: ${JSON.stringify(stats)}
                Current Hour (24h): ${hour}
                User Profile: ${JSON.stringify(memory.profile)}
                Recent Notes: ${JSON.stringify(memory.notes.slice(0, 2))}

                [TASK]
                Greet the user appropriately. 
                - If Scenario is WELCOME_BACK: Be warm, say you missed them or ask if they're ready to continue.
                - If Scenario is NEW_DAY: Give a full contextual greeting (Good morning/afternoon/evening) and briefly mention a goal or project from notes if relevant.
                - Mention a milestone occasionally (e.g., "We've been working together for ${stats.daysTogether} days now!").

                [RULES]
                1. Be VERY brief (1 sentence).
                2. NEVER repeat the same phrase twice. Be creative and charming.
                3. Return JSON: {"greeting": "your message"}.
            `;

            const completion = await groq.chat.completions.create({
                messages: [{ role: 'system', content: prompt }],
                model: 'llama-3.1-8b-instant',
                response_format: { type: "json_object" },
                temperature: 0.9
            });

            return JSON.parse(completion.choices[0].message.content).greeting;
        }

        return "Hello! I'm J, your new assistant. It's wonderful to finally meet you! 😊";
    } catch (err) {
        return null;
    }
};
