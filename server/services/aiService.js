import { 
    getMemoryCache, 
    appendToHistory,
    saveInternalThought
} from './memoryService.js';
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
export const executeWithFailover = async (params) => {
    let attempts = 0;
    const totalKeys = groqKeys.length;
    let modelIs70B = params.model.includes("70b");

    while (attempts < totalKeys * 2) {
        try {
            const client = new Groq({ apiKey: groqKeys[currentKeyIndex] });
            return await client.chat.completions.create(params);
        } catch (error) {
            console.error(`[J Brain] Key ${currentKeyIndex + 1} Error: ${error.message.substring(0, 100)}`);
            
            // Rotate Key
            currentKeyIndex = (currentKeyIndex + 1) % totalKeys;
            attempts++;

            // If we've tried all keys with 70B, switch to 8B
            if (attempts >= totalKeys && modelIs70B) {
                console.warn("[J Brain] Account limit hit for 70B. Switching to 8B Safety Net...");
                params.model = "llama-3.1-8b-instant";
                modelIs70B = false;
            }
            
            await new Promise(r => setTimeout(r, 100)); // Tiny pause
        }
    }
    throw new Error("All API engines exhausted.");
};

/**
 * PDF Smart Vision: Trims data to save tokens and prevent 429s.
 */
export const getRelevantContext = async (userMessage, memory) => {
    const lowerMsg = userMessage.toLowerCase();
    const hasPDFKeyword = lowerMsg.match(/pdf|schedule|d3|batch|lecture|timetable|calendar/);
    
    if (hasPDFKeyword && memory.pdfExtractions?.length > 0) {
        const doc = memory.pdfExtractions[0];
        // Only send the most relevant 8,000 chars to save tokens
        return `[DOCUMENT: ${doc.filename}]\n${doc.fullContent?.substring(0, 8000) || ""}`;
    }
    return "";
};

/**
 * Main AI Engine: No robotic pre-defined messages.
 */
export const generateAIResponse = async (userMessage, onChunk) => {
    try {
        const fullMemory = await getMemoryCache();
        const context = await getRelevantContext(userMessage, fullMemory);
        const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        const messages = [
            { 
                role: 'system', 
                content: `${systemPrompt}\n\n[TIME]: ${time}\n[DATA]: ${context}\n\nINSTRUCTION: Respond in plain text. No JSON required. Keep it professional, caring, and format lists with bullet points.` 
            },
            ...fullMemory.history.slice(-6).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];

        const completion = await executeWithFailover({
            messages,
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7
        });

        const response = completion.choices[0].message.content;

        if (onChunk && response) {
            const words = response.split(' ');
            for (const word of words) {
                onChunk(word + ' ');
                await new Promise(r => setTimeout(r, 10));
            }
        }

        // Save interaction
        await appendToHistory('user', userMessage);
        await appendToHistory('assistant', response);
        await saveInternalThought("Processed user request.", "chat");

        return response;
    } catch (error) {
        console.error("[J Fatal]", error);
        if (onChunk) onChunk("I'm having a bit of trouble with my connection, Boss. Give me a second.");
        return "Error";
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
