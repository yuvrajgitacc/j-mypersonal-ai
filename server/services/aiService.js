import { 
    getMemoryCache, 
    saveNote, 
    saveReminder, 
    logUserMood, 
    getAssociativeContext, 
    saveLongTermFact, 
    getRelationshipStats, 
    getUnspokenThoughts, 
    getRecentJournals, 
    appendToHistory,
    saveInternalThought
} from './memoryService.js';
import { sendNotificationToCenter, sendEmailNotification } from './emailService.js';
import { processJournaling } from './proactiveService.js';
import { systemPrompt } from '../config/systemPrompt.js';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

// 1. Unified API Key Management
const groqKeys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5,
    process.env.GROQ_API_KEY_6
].filter(key => key && key.length > 10);

let currentKeyIndex = 0;

/**
 * Master API Caller: Rotates keys on ANY error and fallbacks to 8B instantly if 70B is limited.
 */
export const executeWithFailover = async (params, allowModelFallback = true) => {
    let attempts = 0;
    const totalKeys = groqKeys.length;
    let originalModel = params.model;
    let modelIs70B = originalModel.includes("70b");

    if (params.response_format?.type === "json_object") {
        const lastMsg = params.messages[params.messages.length - 1];
        if (!lastMsg.content.toLowerCase().includes("json")) {
            lastMsg.content += " (Respond EXACTLY in JSON format)";
        }
    }

    while (attempts < totalKeys * 2) {
        try {
            const client = new Groq({ apiKey: groqKeys[currentKeyIndex] });
            return await client.chat.completions.create(params);
        } catch (error) {
            console.error(`[J Brain] Key ${currentKeyIndex + 1} Error: ${error.message.substring(0, 100)}`);
            
            if (error.status === 429 || error.status === 503 || (error.status >= 500 && error.status <= 599)) {
                currentKeyIndex = (currentKeyIndex + 1) % totalKeys;
                attempts++;

                if (attempts >= totalKeys && modelIs70B && allowModelFallback) {
                    console.warn("[J Brain] Account limit hit for 70B. Switching to 8B Safety Net...");
                    params.model = "llama-3.1-8b-instant";
                    modelIs70B = false;
                }
                await new Promise(r => setTimeout(r, 100));
                continue;
            }
            throw error; 
        }
    }
    throw new Error("All API engines exhausted.");
};

export const getRelevantContext = async (userMessage, memory) => {
    const lowerMsg = userMessage.toLowerCase();
    const hasPDFKeyword = lowerMsg.match(/pdf|schedule|d3|batch|lecture|timetable|calendar/);
    
    if (hasPDFKeyword && memory.pdfExtractions?.length > 0) {
        const doc = memory.pdfExtractions[0];
        return `[DOCUMENT: ${doc.filename}]\n${doc.fullContent?.substring(0, 8000) || ""}`;
    }
    
    // Also inject recent journal if asking for it
    if (lowerMsg.includes("journal") || lowerMsg.includes("diary")) {
        const journals = await getRecentJournals(1);
        if (journals.length > 0) {
            return `[YOUR PRIVATE DIARY ENTRY]: ${journals[0].date} - ${journals[0].content}`;
        }
    }
    
    return "No specific documents loaded.";
};

/**
 * BACKGROUND ACTION ENGINE (The Real Secretary Logic)
 * This runs silently after J speaks. It reads the chat and executes real system commands.
 */
const executeBackgroundActions = async (userMessage, jResponse, userProfile) => {
    try {
        console.log("[J Action Engine] Scanning for commands...");
        const prompt = `You are J's Action Engine. Analyze the conversation and extract real actions.
        Boss: "${userMessage}"
        J: "${jResponse}"
        
        [RULES]
        1. send_journal_email: true if Boss asked to see/email his journal or diary (e.g. "send journal", "mail diary", "today's entry").
        2. write_journal_now: true if Boss asked J to write/reflect now OR if he asked for today's journal and it's not likely written.
        3. facts_to_remember: any specific personal facts or project details Boss mentioned.
        4. reminders_to_set: specific time-based reminders.

        Return JSON:
        {
            "send_journal_email": boolean,
            "write_journal_now": boolean,
            "facts_to_remember": [{"fact": "str", "category": "str"}],
            "reminders_to_set": [{"event": "str", "time": "str"}]
        }`;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        }, false);

        const actions = JSON.parse(res.choices[0].message.content);
        const today = new Date().toISOString().split('T')[0];

        // 1. WRITE JOURNAL (IF REQUESTED OR NEEDED FOR EMAIL)
        if (actions.write_journal_now) {
            console.log("[J Action] Writing journal now...");
            await processJournaling(today);
        }

        // 2. EXECUTE EMAIL
        if (actions.send_journal_email) {
            console.log("[J Action] Boss requested journal via email.");
            const journals = await getRecentJournals(1);
            
            if (journals.length > 0 && journals[0].date === today) {
                // Today's journal exists, send it
                const j = journals[0];
                await sendEmailNotification(`J's Secret Journal: ${j.date} 🌙`, j.content, `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd;"><h2>J's Private Journal</h2><p><b>Date:</b> ${j.date}</p><p style="white-space: pre-wrap;">${j.content}</p></div>`, "chat");
            } else if (!actions.write_journal_now) {
                // Today's doesn't exist and we didn't just write it, let's write it now then send
                console.log("[J Action] Today's journal missing. Writing first...");
                await processJournaling(today);
                const newJournals = await getRecentJournals(1);
                if (newJournals.length > 0) {
                    const j = newJournals[0];
                    await sendEmailNotification(`J's Secret Journal: ${j.date} 🌙`, j.content, `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd;"><h2>J's Private Journal</h2><p><b>Date:</b> ${j.date}</p><p style="white-space: pre-wrap;">${j.content}</p></div>`, "chat");
                }
            }
        }

        // 3. EXECUTE FACTS
        if (actions.facts_to_remember?.length > 0) {
            for (const f of actions.facts_to_remember) {
                await saveLongTermFact(f.fact, f.category);
            }
        }

        // 4. EXECUTE REMINDERS
        if (actions.reminders_to_set?.length > 0) {
            for (const r of actions.reminders_to_set) {
                await saveReminder(r.event, r.time);
            }
        }

    } catch (e) {
        console.error("[J Action Engine] Error:", e);
    }
};

/**
 * Main AI Engine: Structured output for Thoughts + Response, followed by Background Action trigger.
 */
export const generateAIResponse = async (userMessage, onChunk, onReminderSaved) => {
    try {
        const fullMemory = await getMemoryCache();
        const context = await getRelevantContext(userMessage, fullMemory);
        const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        const messages = [
            { 
                role: 'system', 
                content: `${systemPrompt}\n\n[TIME]: ${time}\n[DATA]: ${context}\n\nINSTRUCTION: Output JSON exactly like this: {"internal_monologue": "your private thoughts here", "final_response": "your actual reply to Boss"}` 
            },
            ...fullMemory.history.slice(-6).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];

        console.log("[J Brain] Thinking...");
        const completion = await executeWithFailover({
            messages,
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.7
        });

        const result = JSON.parse(completion.choices[0].message.content);
        let response = result.final_response || "I am processing that, Boss.";
        const thought = result.internal_monologue || "Analyzing...";

        // Stream thought to terminal
        console.log(`[J Thought]: ${thought}`);
        await saveInternalThought(thought, "scratchpad");

        // Stream response back to user
        if (onChunk && response) {
            const words = response.split(' ');
            for (const word of words) {
                onChunk(word + ' ');
                await new Promise(r => setTimeout(r, 15));
            }
        }

        // Save interaction
        await appendToHistory('user', userMessage);
        await appendToHistory('assistant', response);

        // SILENTLY TRIGGER REAL BACKEND ACTIONS (Reminders, Facts, Emails)
        executeBackgroundActions(userMessage, response, fullMemory.profile).catch(e => console.error(e));

        return response;
    } catch (error) {
        console.error("[J Fatal]", error);
        const msg = "I'm having a bit of trouble with my connection right now, Boss. Let's try again in a moment.";
        if (onChunk) onChunk(msg);
        return msg;
    }
};

// Simplified Helpers for other services
export const extractPDFInfo = async (text) => {
    try {
        const res = await executeWithFailover({
            messages: [{ role: 'system', content: `Summarize this PDF. JSON: {"summary": "str"}. Text: ${text.substring(0, 10000)}` }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });
        return JSON.parse(res.choices[0].message.content);
    } catch (e) { return { summary: "Failed summary" }; }
};

export const scanForUpcomingEvents = async () => { return []; };
