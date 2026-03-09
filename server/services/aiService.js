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
import { sendNotificationToCenter } from './emailService.js';
import { manualTriggerJournaling } from './proactiveService.js';
import { systemPrompt } from '../config/systemPrompt.js';
import Groq from 'groq-sdk';
import Sentiment from 'sentiment';
import dotenv from 'dotenv';

dotenv.config();
const sentimentAnalysis = new Sentiment();

// 1. Bulletproof API Client Setup
const groqKeys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5,
    process.env.GROQ_API_KEY_6
].filter(key => key && key.length > 10); // Ensure keys are real

let currentKeyIndex = 0;

/**
 * The ONLY function that talks to Groq. 
 * It rotates keys and models automatically.
 */
export const executeWithFailover = async (params) => {
    let attempts = 0;
    const maxAttempts = groqKeys.length * 2; // Try all keys twice

    // Safety: Ensure JSON is requested
    if (params.response_format?.type === "json_object") {
        const lastMsg = params.messages[params.messages.length - 1];
        if (!lastMsg.content.toLowerCase().includes("json")) {
            lastMsg.content += " (Respond in JSON format)";
        }
    }

    while (attempts < maxAttempts) {
        try {
            const key = groqKeys[currentKeyIndex];
            const client = new Groq({ apiKey: key });
            const completion = await client.chat.completions.create(params);
            
            // If we got here, it worked!
            return completion;
        } catch (error) {
            console.error(`[Groq Failover] Key ${currentKeyIndex + 1} failed: ${error.message}`);
            
            // If rate limited or server error, rotate
            if (error.status === 429 || error.status >= 500) {
                currentKeyIndex = (currentKeyIndex + 1) % groqKeys.length;
                attempts++;
                
                // If we've tried all keys, fallback to 8B model for the next sweep
                if (attempts >= groqKeys.length && params.model.includes("70b")) {
                    console.warn("[Groq Failover] 70B exhausted on all keys. Falling back to 8B.");
                    params.model = "llama-3.1-8b-instant";
                }
                continue;
            }
            throw error; // Other errors (auth, formatting) should stop here
        }
    }
    throw new Error("All Groq keys failed.");
};

// 2. High-Accuracy Context Selector
export const getRelevantContext = async (userMessage, memory) => {
    try {
        const availableDocs = memory.pdfExtractions.map(d => ({ id: d.id, filename: d.filename }));
        const forcePDF = userMessage.toLowerCase().match(/pdf|schedule|d3|batch|lecture|timetable/);

        const selection = await executeWithFailover({
            messages: [{ role: 'system', content: `Which docs are needed? JSON: {"docIds": []}. Docs: ${JSON.stringify(availableDocs)}` }, { role: 'user', content: userMessage }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });

        let { docIds } = JSON.parse(selection.choices[0].message.content);
        if (forcePDF && availableDocs.length > 0) docIds = [availableDocs[0].id];

        const relevantDocs = memory.pdfExtractions
            .filter(d => (docIds || []).includes(d.id))
            .map(d => ({ filename: d.filename, fullContent: d.fullContent }));

        return { docs: relevantDocs, profile: memory.profile };
    } catch (e) { return { docs: [], profile: memory.profile }; }
};

// 3. Main Response Engine (No hardcoded robotic replies)
export const generateAIResponse = async (userMessage, onChunk, onReminderSaved) => {
    try {
        const fullMemory = await getMemoryCache();
        const { docs, profile } = await getRelevantContext(userMessage, fullMemory);
        const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        const messages = [
            { 
                role: 'system', 
                content: `${systemPrompt}\n\n[USER DATA]\nDocs: ${JSON.stringify(docs)}\nTime: ${currentTime}\nUser: ${JSON.stringify(profile)}` 
            },
            ...fullMemory.history.slice(-10).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];

        const completion = await executeWithFailover({
            messages,
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.7
        });

        const result = JSON.parse(completion.choices[0].message.content);
        const response = result.final_response || result.message || "I'm having trouble thinking, Boss. Let's try that again.";
        const thought = result.internal_monologue || "Analyzing...";

        // Stream back to user
        if (onChunk) {
            for (const chunk of response.split(' ')) {
                onChunk(chunk + ' ');
                await new Promise(r => setTimeout(r, 15));
            }
        }

        // Save everything
        await saveInternalThought(thought, "scratchpad");
        await appendToHistory('user', userMessage);
        await appendToHistory('assistant', response);

        return response;
    } catch (error) {
        console.error("Fatal Response Error:", error);
        if (onChunk) onChunk("I'm sorry, Boss. My connection is weak right now. Try again in a minute.");
        return "Error";
    }
};

// 4. PDF Extraction Vision
export const extractPDFInfo = async (text) => {
    try {
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Analyze PDF. Return JSON: {"summary": "str", "entities": [], "actionItems": []}. Text: ${text.substring(0, 25000)}` }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (e) { return { summary: "Failed", entities: [] }; }
};

// 5. Background Scan
export const scanForUpcomingEvents = async (memory) => {
    try {
        const context = JSON.stringify({ docs: (memory.pdfExtractions || []).slice(0, 2) });
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Events in 48h? JSON: [{"event": "str"}]. Context: ${context}` }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }
        });
        const res = JSON.parse(completion.choices[0].message.content);
        return res.events || res || [];
    } catch (e) { return []; }
};
