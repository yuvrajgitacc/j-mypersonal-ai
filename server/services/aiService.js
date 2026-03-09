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
        console.log("[J Action Engine] Scanning conversation for system commands...");
        const prompt = `You are J's Action Engine. Analyze the conversation and extract real actions to execute on the backend.
        
        [CONVERSATION]
        Boss: "${userMessage}"
        J: "${jResponse}"
        
        [RULES]
        1. send_journal_email: true ONLY if Boss explicitly asked to email the journal/diary.
        2. facts_to_remember: extract explicit facts Boss told J to remember (e.g., "I am in D3").
        3. reminders_to_set: extract explicit requests to be reminded. Format time clearly.

        Return ONLY JSON:
        {
            "send_journal_email": boolean,
            "write_journal_now": boolean,
            "facts_to_remember": [{"fact": "str", "category": "str"}],
            "reminders_to_set": [{"event": "str", "time": "str"}]
        }`;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant', // Fast, cheap action extraction
            response_format: { type: "json_object" },
            temperature: 0.1
        }, false);

        const actions = JSON.parse(res.choices[0].message.content);

        // 1. EXECUTE EMAIL
        if (actions.send_journal_email) {
            console.log("[J Action] Executing real email delivery...");
            const journals = await getRecentJournals(1);
            if (journals.length > 0) {
                const j = journals[0];
                const html = `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd;">
                                <h2 style="color: #3498db;">J's Private Journal</h2>
                                <p><b>Date:</b> ${j.date}</p>
                                <p style="white-space: pre-wrap;">${j.content}</p>
                              </div>`;
                await sendEmailNotification(`J's Secret Journal: ${j.date} 🌙`, j.content, html, "chat");
            }
        }

        // 2. EXECUTE FACTS
        if (actions.facts_to_remember?.length > 0) {
            for (const f of actions.facts_to_remember) {
                console.log(`[J Action] Saving fact: ${f.fact}`);
                await saveLongTermFact(f.fact, f.category);
            }
        }

        // 3. EXECUTE REMINDERS
        if (actions.reminders_to_set?.length > 0) {
            for (const r of actions.reminders_to_set) {
                console.log(`[J Action] Setting reminder: ${r.event} at ${r.time}`);
                await saveReminder(r.event, r.time);
            }
        }

        // 4. WRITE JOURNAL
        if (actions.write_journal_now) {
            const today = new Date().toISOString().split('T')[0];
            await processJournaling(today);
        }

    } catch (e) {
        console.error("[J Action Engine] Failed to parse or execute actions.", e);
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
