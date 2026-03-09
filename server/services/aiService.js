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
    saveInternalThought,
    getHormones,
    getPersonalityRules
} from './memoryService.js';
import { sendNotificationToCenter, sendEmailNotification, sendJournalEmail } from './emailService.js';
import { processJournaling } from './proactiveService.js';
import { systemPrompt } from '../config/systemPrompt.js';
import { evaluateEmotionalState, getEmotionalPromptInjection } from './emotion/emotionEngine.js';
import { identifyResearchNeeds, researchTopic } from './researchService.js';
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
 */
const executeBackgroundActions = async (userMessage, jResponse, fullMemory) => {
    try {
        console.log("[J Action Engine] Scanning for commands...");
        const prompt = `Analyze conversation and extract actions. Boss: "${userMessage}". J: "${jResponse}". 
        Return JSON: {"send_journal_email": bool, "write_journal_now": bool, "facts_to_remember": [], "reminders_to_set": []}`;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        }, false);

        const actions = JSON.parse(res.choices[0].message.content);
        const today = new Date().toISOString().split('T')[0];

        if (actions.write_journal_now) {
            console.log("[J Action] Writing journal now...");
            await processJournaling(today);
        }
        
        if (actions.send_journal_email) {
            console.log("[J Action] Boss requested journal. Fetching most recent entry...");
            const journals = await getRecentJournals(1);
            if (journals.length > 0) {
                const j = journals[0];
                await sendJournalEmail(j.date, j.content, j.mood_tone);
            } else {
                console.log("[J Action] Today's journal missing. Writing first...");
                await processJournaling(today);
                const newJournals = await getRecentJournals(1);
                if (newJournals.length > 0) {
                    const nj = newJournals[0];
                    await sendJournalEmail(nj.date, nj.content, nj.mood_tone);
                }
            }
        }

        if (actions.facts_to_remember?.length > 0) {
            for (const f of actions.facts_to_remember) await saveLongTermFact(f.fact, f.category);
        }

        if (actions.reminders_to_set?.length > 0) {
            for (const r of actions.reminders_to_set) await saveReminder(r.event, r.time);
        }

        // --- AUTONOMOUS RESEARCH TRIGGER ---
        const researchCheck = await identifyResearchNeeds(fullMemory.history);
        if (researchCheck.needsResearch) {
            console.log(`[J Action] Knowledge gap found. Researching: ${researchCheck.topic}`);
            researchTopic(researchCheck.topic).catch(e => console.error(e));
        }

    } catch (e) { console.error("[J Action Engine] Error:", e); }
};

/**
 * Main AI Engine
 */
export const generateAIResponse = async (userMessage, onChunk, onReminderSaved) => {
    try {
        const fullMemory = await getMemoryCache();
        const context = await getRelevantContext(userMessage, fullMemory);
        const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        
        const emotionalState = await getEmotionalPromptInjection();
        const rules = await getPersonalityRules(5);
        const learnedRulesContext = rules.length > 0 ? `\n[LEARNED PROFESSIONAL SECRETS]\n${rules.map(r => "- " + r.rule).join('\n')}` : "";

        const messages = [
            { 
                role: 'system', 
                content: `${systemPrompt}\n\n${emotionalState}${learnedRulesContext}\n\n[TIME]: ${time}\n[DATA]: ${context}\n\nINSTRUCTION: Output JSON exactly like this: {"internal_monologue": "thinking", "final_response": "reply"}` 
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

        await saveInternalThought(thought, "scratchpad");

        if (onChunk && response) {
            for (const chunk of response.split(' ')) {
                onChunk(chunk + ' ');
                await new Promise(r => setTimeout(r, 10));
            }
        }

        await appendToHistory('user', userMessage);
        await appendToHistory('assistant', response);

        executeBackgroundActions(userMessage, response, fullMemory).catch(e => console.error(e));
        evaluateEmotionalState(userMessage, response).catch(e => console.error(e));

        return response;
    } catch (error) {
        console.error("[J Fatal]", error);
        if (onChunk) onChunk("I'm having a bit of trouble with my connection right now, Boss.");
        return "Error";
    }
};

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
