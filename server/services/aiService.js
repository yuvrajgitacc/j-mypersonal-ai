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

// Load all 6 keys
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
 * Robust Failover Executor with Automatic Model Fallback
 */
const executeWithFailover = async (params, allowModelFallback = true) => {
    let attempts = 0;
    let originalModel = params.model;
    
    // Ensure JSON keyword is present for Groq JSON mode
    if (params.response_format?.type === "json_object") {
        const lastMsg = params.messages[params.messages.length - 1];
        if (!lastMsg.content.toLowerCase().includes("json")) {
            lastMsg.content += " (Respond in JSON format)";
        }
    }

    while (attempts < clients.length * 2) { // Try all keys twice (once for 70B, once for 8B if needed)
        try {
            const client = clients[currentClientIndex];
            return await client.chat.completions.create(params);
        } catch (error) {
            console.warn(`[Groq API] Key ${currentClientIndex + 1} (${params.model}) Error:`, error.message);
            
            if (error.status === 429 || error.status === 503 || (error.status >= 500 && error.status <= 599)) {
                currentClientIndex = (currentClientIndex + 1) % clients.length;
                attempts++;

                // If we've tried all keys and we're on 70B, fallback to 8B and try again
                if (attempts === clients.length && allowModelFallback && originalModel.includes("70b")) {
                    console.log(`[Groq API] CRITICAL: 70B Limited. Falling back to 8B Safety Net...`);
                    params.model = "llama-3.1-8b-instant";
                    // Reset attempt counter for the fallback model sweep
                }
                
                await new Promise(r => setTimeout(r, 200));
            } else {
                throw error;
            }
        }
    }
    throw new Error(`All Groq keys and fallback models failed.`);
};

export const findAssociativeLinks = async (userMessage) => {
    try {
        const context = await getAssociativeContext();
        const prompt = `Identify links in JSON: {"linkFound": bool, "connection": "str"}. Context: ${JSON.stringify(context.longTermFacts)}`;
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.3
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) { return { linkFound: false }; }
};

export const getRelevantContext = async (userMessage, memory) => {
    try {
        const lowerMsg = userMessage.toLowerCase();
        const availableDocs = memory.pdfExtractions.map(d => ({ id: d.id, filename: d.filename }));
        const forcePDF = lowerMsg.includes("schedule") || lowerMsg.includes("lecture") || lowerMsg.includes("d3") || lowerMsg.includes("batch") || lowerMsg.includes("pdf");
        
        const selection = await executeWithFailover({
            messages: [{ role: 'system', content: `Select relevant doc IDs in JSON: {"docIds": []}. Docs: ${JSON.stringify(availableDocs)}` }, { role: 'user', content: userMessage }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        
        let { docIds } = JSON.parse(selection.choices[0].message.content);
        if (forcePDF && availableDocs.length > 0 && (!docIds || docIds.length === 0)) docIds = [availableDocs[0].id];
        
        const relevantDocs = memory.pdfExtractions.filter(d => (docIds || []).includes(d.id)).map(d => ({ filename: d.filename, summary: d.summary, fullContent: d.fullContent }));
        return { docs: relevantDocs, notes: [], profile: memory.profile };
    } catch (err) { return { docs: [], notes: [], profile: memory.profile }; }
};

export const performInternalReview = async (userMessage, context, draftResponse) => {
    try {
        if (!draftResponse || draftResponse.length < 5) return { status: "PASS", critique: "" };
        const prompt = `Audit draft for hallucinations or logic errors ONLY. Tone doesn't matter. JSON: {"status": "PASS"/"FAIL", "critique": "str"}. Draft: ${draftResponse}`;
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
      const memoryContext = `Context: ${JSON.stringify(relevantContext.docs)}`;
      const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      
      const messages = [
        { role: 'system', content: `${systemPrompt}\nTime: ${currentTime}\n${memoryContext}` },
        ...fullMemory.history.slice(-8).map(m => ({ role: m.role, content: m.content })),
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
      const internalThought = result.internal_monologue || "Analyzing...";
      const finalResponse = result.final_response || "I'm ready to assist you, Boss.";

      console.log("[J Brain] Reviewing...");
      const review = await performInternalReview(userMessage, memoryContext, finalResponse);
      
      let verifiedResponse = finalResponse;
      if (review.status === "FAIL") {
          console.log(`[J Critic Audit]: FAIL - ${review.critique}`);
          const secondChance = await executeWithFailover({
            messages: [...messages, { role: 'assistant', content: JSON.stringify(result) }, { role: 'system', content: `Fix logic error: ${review.critique}. Use JSON.` }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" }, 
            temperature: 0.3
          });
          const fixed = JSON.parse(secondChance.choices[0].message.content);
          verifiedResponse = fixed.final_response || finalResponse;
      }

      if (internalThought && internalThought !== "undefined") {
          await saveInternalThought(internalThought, "scratchpad");
      }

      if (onChunk && verifiedResponse) {
          for (const chunk of verifiedResponse.split(' ')) {
              onChunk(chunk + ' ');
              await new Promise(r => setTimeout(r, 15));
          }
      }

      if (verifiedResponse) {
          await appendToHistory('user', userMessage);
          await appendToHistory('assistant', verifiedResponse);
      }

      return verifiedResponse;
  } catch (error) {
      console.error(`AI Fatal Error:`, error.message);
      const msg = "I'm having a brief moment of clarity, Boss. Let's continue.";
      if (onChunk) onChunk(msg);
      return msg;
  }
};

export const extractPDFInfo = async (text) => {
    try {
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Analyze PDF in JSON: {"summary": "str", "entities": []}.` }, { role: 'user', content: text.substring(0, 20000) }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) { return { summary: "Extraction failed", entities: [] }; }
};

export const scanForUpcomingEvents = async (memory) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const context = JSON.stringify({ docs: (memory.pdfExtractions || []).slice(0, 2) });
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Upcoming events? JSON: [{"event": "str"}]. Today: ${today}` }, { role: 'user', content: `Context: ${context}` }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        const result = JSON.parse(completion.choices[0].message.content);
        return Array.isArray(result) ? result : (result.events || []);
    } catch (err) { return []; }
};
