import { 
    getMemoryCache, 
    saveMemory, 
    saveNote, 
    saveReminder, 
    logUserMood, 
    getAssociativeContext, 
    saveLongTermFact, 
    getRelationshipStats, 
    getUnspokenThoughts, 
    getRecentJournals, 
    markThoughtAsShared, 
    appendToHistory,
    saveInternalThought,
    getIdeaGraph
} from './memoryService.js';
import { sendEmailNotification, sendNotificationToCenter, sendJournalEmail } from './emailService.js';
import { performWebSearch } from './searchService.js';
import { processLinkForResearch } from './researchService.js';
import { manualTriggerJournaling } from './proactiveService.js';
import { systemPrompt } from '../config/systemPrompt.js';
import Groq from 'groq-sdk';
import Sentiment from 'sentiment';

const sentimentAnalysis = new Sentiment();

import dotenv from 'dotenv';
dotenv.config();

const groqKeys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5,
    process.env.GROQ_API_KEY_6
].filter(key => key && key.trim() !== "" && key !== "PASTE_YOUR_GROQ_KEY_HERE");

const clients = groqKeys.length > 0 ? groqKeys.map(k => new Groq({ apiKey: k })) : [new Groq({ apiKey: 'missing_key' })];
let currentClientIndex = 0;

/**
 * Robust Failover Executor with Zero-Latency Safety Net
 */
export const executeWithFailover = async (params, allowModelFallback = true) => {
    let attempts = 0;
    let originalModel = params.model;
    
    if (params.response_format?.type === "json_object") {
        const lastMsg = params.messages[params.messages.length - 1];
        if (!lastMsg.content.toLowerCase().includes("json")) {
            lastMsg.content += " (Respond EXACTLY in JSON format)";
        }
    }

    while (attempts < clients.length * 2) {
        try {
            const client = clients[currentClientIndex];
            return await client.chat.completions.create(params);
        } catch (error) {
            if (error.status === 429 || error.status === 503 || (error.status >= 500 && error.status <= 599)) {
                currentClientIndex = (currentClientIndex + 1) % clients.length;
                attempts++;
                if (attempts >= clients.length && allowModelFallback && originalModel.includes("70b")) {
                    console.log(`[J Brain] 70B Exhausted. Switching to 8B Safety Net for 100% uptime.`);
                    params.model = "llama-3.1-8b-instant";
                }
                continue;
            }
            throw error;
        }
    }
    throw new Error(`All keys and fallback models exhausted.`);
};

export const getRelevantContext = async (userMessage, memory) => {
    try {
        const lowerMsg = userMessage.toLowerCase();
        const availableDocs = memory.pdfExtractions.map(d => ({ id: d.id, filename: d.filename }));
        const forcePDF = lowerMsg.includes("schedule") || lowerMsg.includes("lecture") || lowerMsg.includes("d3") || lowerMsg.includes("batch") || lowerMsg.includes("pdf") || lowerMsg.includes("test");
        
        const selection = await executeWithFailover({
            messages: [{ role: 'system', content: `Identify relevant doc IDs. JSON: {"docIds": []}. Docs: ${JSON.stringify(availableDocs)}` }, { role: 'user', content: userMessage }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        
        let { docIds } = JSON.parse(selection.choices[0].message.content);
        if (forcePDF && availableDocs.length > 0 && (!docIds || docIds.length === 0)) docIds = [availableDocs[0].id];
        const relevantDocs = memory.pdfExtractions.filter(d => (docIds || []).includes(d.id)).map(d => ({ filename: d.filename, summary: d.summary, fullContent: d.fullContent }));
        return { docs: relevantDocs, profile: memory.profile };
    } catch (err) { return { docs: [], profile: memory.profile }; }
};

export const performInternalReview = async (userMessage, context, draftResponse) => {
    try {
        if (!draftResponse) return { status: "PASS", critique: "" };
        const prompt = `You are a Logic Auditor. ONLY fail if J made a factual error or hallucinated data. IGNORE tone, politeness, or length. JSON: {"status": "PASS"/"FAIL", "critique": "str"}. Draft: ${draftResponse}`;
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) { return { status: "PASS", critique: "" }; }
};

export const generateAIResponse = async (userMessage, onChunk, onReminderSaved) => {
  try {
      const fullMemory = await getMemoryCache();
      const relevantContext = await getRelevantContext(userMessage, fullMemory);
      const memoryContext = `Context Data: ${JSON.stringify(relevantContext.docs)}`;
      const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      
      const messages = [
        { role: 'system', content: `${systemPrompt}\n[DATA]: ${memoryContext}\nTime: ${currentTime}` },
        ...fullMemory.history.slice(-8).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      console.log("[J Brain] Processing...");
      const completion = await executeWithFailover({ 
          messages, 
          model: 'llama-3.3-70b-versatile', 
          response_format: { type: "json_object" }, 
          temperature: 0.7 
      });

      const result = JSON.parse(completion.choices[0].message.content);
      let internalThought = result.internal_monologue || "Analyzing user intent...";
      let finalResponse = result.final_response;

      // CRITICAL: Force 8B to generate a REAL response if 70B gave us nothing
      if (!finalResponse || finalResponse.length < 2) {
          console.log("[J Brain] 70B failed to produce a response. Forcing 8B recovery...");
          const rescue = await executeWithFailover({
              messages,
              model: 'llama-3.1-8b-instant',
              response_format: { type: "json_object" },
              temperature: 0.7
          });
          const rescueResult = JSON.parse(rescue.choices[0].message.content);
          finalResponse = rescueResult.final_response;
          internalThought = rescueResult.internal_monologue;
      }

      console.log("[J Brain] Auditing...");
      const review = await performInternalReview(userMessage, memoryContext, finalResponse);
      
      if (review.status === "FAIL") {
          const secondChance = await executeWithFailover({
            messages: [...messages, { role: 'assistant', content: JSON.stringify(result) }, { role: 'system', content: `FACTUAL ERROR: ${review.critique}. Fix logic in JSON.` }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }, 
            temperature: 0.1
          });
          const fixed = JSON.parse(secondChance.choices[0].message.content);
          finalResponse = fixed.final_response || finalResponse;
      }

      if (internalThought) await saveInternalThought(internalThought, "scratchpad");
      
      if (onChunk && finalResponse) {
          for (const chunk of finalResponse.split(' ')) {
              onChunk(chunk + ' ');
              await new Promise(r => setTimeout(r, 10));
          }
      }

      if (finalResponse) {
          await appendToHistory('user', userMessage);
          await appendToHistory('assistant', finalResponse);
      }

      return finalResponse;
  } catch (error) {
      console.error(`AI Critical Error:`, error.message);
      const msg = "I'm here, Boss. Just taking a deep breath. How can I help?";
      if (onChunk) onChunk(msg);
      return msg;
  }
};

export const extractPDFInfo = async (text) => {
    try {
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Analyze PDF. Extract dates/events. JSON: {"summary": "str", "entities": []}.` }, { role: 'user', content: text.substring(0, 20000) }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) { return { summary: "Failed", entities: [] }; }
};

export const scanForUpcomingEvents = async (memory) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const context = JSON.stringify({ docs: (memory.pdfExtractions || []).slice(0, 2) });
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Events in 48h? JSON: [{"event": "str"}]. Today: ${today}` }, { role: 'user', content: `Context: ${context}` }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        const result = JSON.parse(completion.choices[0].message.content);
        return Array.isArray(result) ? result : (result.events || []);
    } catch (err) { return []; }
};
