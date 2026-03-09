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
    getPersonalityRules,
    saveMemory
} from './memoryService.js';
import { sendNotificationToCenter, sendEmailNotification, sendJournalEmail } from './emailService.js';
import { processJournaling } from './proactiveService.js';
import { systemPrompt } from '../config/systemPrompt.js';
import { evaluateEmotionalState, getEmotionalPromptInjection } from './emotion/emotionEngine.js';
import { identifyResearchNeeds, researchTopic } from './researchService.js';
import { proposeSelfImprovement, applySelfImprovement } from './codeService.js';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Global variable to hold the last proposed upgrade for J
let lastProposedUpgrade = null;

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
    const hasPDFKeyword = lowerMsg.match(/pdf|schedule|batch|lecture|timetable|calendar/);
    
    let context = "";

    // 1. PDF Context
    if (hasPDFKeyword && memory.pdfExtractions?.length > 0) {
        const doc = memory.pdfExtractions[0];
        context += `\n[DOCUMENT: ${doc.filename}]\n${doc.fullContent?.substring(0, 8000) || ""}\n`;
    }
    
    // 2. Journal Context
    if (lowerMsg.includes("journal") || lowerMsg.includes("diary")) {
        const journals = await getRecentJournals(1);
        if (journals.length > 0) context += `\n[YOUR PRIVATE DIARY ENTRY]: ${journals[0].content}\n`;
    }

    // 3. MASTER KNOWLEDGE
    const { longTermFacts } = await getAssociativeContext();
    if (longTermFacts.length > 0) {
        context += `\n[LEARNED MASTER KNOWLEDGE]\n${longTermFacts.map(f => `- ${f.fact}`).join('\n')}\n`;
    }

    return context || "No specific data loaded.";
};

/**
 * BACKGROUND ACTION ENGINE (The Real Secretary Logic)
 */
const executeBackgroundActions = async (userMessage, jResponse, fullMemory) => {
    try {
        console.log("[J Action Engine] Scanning conversation...");
        const prompt = `Analyze conversation and extract real system actions.
        Boss: "${userMessage}"
        J: "${jResponse}"
        Current Profile: ${JSON.stringify(fullMemory.profile)}
        Pending Upgrade Available: ${lastProposedUpgrade ? 'YES' : 'NO'}
        
        Return JSON:
        {
            "send_journal_email": boolean,
            "send_generic_email": {"requested": boolean, "subject": "str", "body": "str"},
            "update_profile": {"requested": boolean, "updates": {"name": "str", "email": "str"}},
            "propose_self_upgrade": boolean,
            "apply_pending_upgrade": boolean,
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

        // 1. UPDATE PROFILE
        if (actions.update_profile?.requested) {
            console.log("[J Action] Updating profile records...");
            await saveMemory({ profile: actions.update_profile.updates });
        }

        // 2. SELF-MODIFICATION ENGINE
        if (actions.propose_self_upgrade) {
            const proposal = await proposeSelfImprovement();
            if (proposal) lastProposedUpgrade = proposal;
        }

        if (actions.apply_pending_upgrade && lastProposedUpgrade) {
            const result = await applySelfImprovement(lastProposedUpgrade);
            if (result.success) lastProposedUpgrade = null;
        }

        // 3. WRITE JOURNAL
        if (actions.write_journal_now) {
            console.log("[J Action] Writing journal...");
            await processJournaling(today);
        }
        
        // 4. SEND JOURNAL
        if (actions.send_journal_email) {
            console.log("[J Action] Sending journal email...");
            const journals = await getRecentJournals(1);
            if (journals.length > 0) {
                const j = journals[0];
                await sendJournalEmail(j.date, j.content, j.mood_tone);
            }
        }

        // 5. SEND GENERIC EMAIL
        if (actions.send_generic_email?.requested) {
            console.log(`[J Action] Sending requested email: ${actions.send_generic_email.subject}`);
            await sendEmailNotification(
                actions.send_generic_email.subject || "Message from J Secretary",
                actions.send_generic_email.body || "Hi Boss!",
                `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                    <p style="font-size: 16px; color: #333;">${actions.send_generic_email.body}</p>
                </div>`,
                "general"
            );
        }

        // 6. FACTS & REMINDERS
        if (actions.facts_to_remember?.length > 0) {
            for (const f of actions.facts_to_remember) await saveLongTermFact(f.fact, f.category);
        }
        if (actions.reminders_to_set?.length > 0) {
            for (const r of actions.reminders_to_set) await saveReminder(r.event, r.time);
        }

        // 7. RESEARCH
        const researchCheck = await identifyResearchNeeds(fullMemory.history);
        if (researchCheck.needsResearch) researchTopic(researchCheck.topic).catch(e => console.error(e));

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
                content: `${systemPrompt}
                
                [BOSS PROFILE]
                Name: ${fullMemory.profile.name}
                Email: ${fullMemory.profile.email}
                
                ${emotionalState}${learnedRulesContext}
                
                [TIME]: ${time}
                [DATA]: ${context}
                
                INSTRUCTION: Output JSON exactly like this: {"internal_monologue": "thinking", "final_response": "reply"}` 
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
        const response = result.final_response || "I am processing that, Boss.";
        const internalThought = result.internal_monologue || "Analyzing...";

        await saveInternalThought(internalThought, "scratchpad");

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
