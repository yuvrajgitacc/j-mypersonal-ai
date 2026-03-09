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
].filter(key => key && key.trim() !== "");

const clients = groqKeys.length > 0 ? groqKeys.map(k => new Groq({ apiKey: k })) : [new Groq({ apiKey: 'missing_key' })];
let currentClientIndex = 0;

const executeWithFailover = async (params) => {
    let attempts = 0;
    if (params.response_format?.type === "json_object") {
        const lastMsg = params.messages[params.messages.length - 1];
        if (!lastMsg.content.toLowerCase().includes("json")) {
            lastMsg.content += " (Respond in JSON format)";
        }
    }
    while (attempts < clients.length) {
        try {
            const client = clients[currentClientIndex];
            return await client.chat.completions.create(params);
        } catch (error) {
            console.error(`[Groq API] Error on Key ${currentClientIndex + 1}:`, error.message);
            if (error.status === 429 || (error.status >= 500 && error.status <= 599)) {
                currentClientIndex = (currentClientIndex + 1) % clients.length;
                attempts++;
                if (attempts < clients.length) console.log(`[Groq API] Failover: Rotating to Key ${currentClientIndex + 1}...`);
            } else {
                throw error;
            }
        }
    }
    throw new Error(`All ${clients.length} Groq API keys failed or were rate-limited.`);
};

export const getInternalThoughtsContext = async (userMessage) => {
    const thoughts = await getUnspokenThoughts(3);
    const journals = await getRecentJournals(1);
    let context = "\n[J'S RECENT WORKING MEMORY (INTERNAL MONOLOGUES)]\n";
    if (thoughts.length > 0) {
        thoughts.forEach((t, i) => { context += `Thought ${i + 1}: ${t.thought}\n`; });
    }
    return context;
};

export const findAssociativeLinks = async (userMessage) => {
    try {
        const context = await getAssociativeContext();
        const prompt = `Identify links. JSON: {"linkFound": bool, "connection": "str"}. Context: ${JSON.stringify(context)}`;
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.3
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) { return { linkFound: false }; }
};

const getEmotionLabel = (score) => {
    if (score > 3) return "Very Happy";
    if (score > 0) return "Positive";
    if (score === 0) return "Neutral";
    return "Stressed";
};

export const checkSearchNeeded = async (userMessage) => {
    try {
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: 'Search needed? JSON: {"needsSearch": bool, "query": "str"}.' }, { role: 'user', content: userMessage }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) { return { needsSearch: false }; }
};

export const getRelevantContext = async (userMessage, memory) => {
    try {
        const lowerMsg = userMessage.toLowerCase();
        const availableDocs = memory.pdfExtractions.map(d => ({ id: d.id, filename: d.filename }));
        const forcePDF = lowerMsg.includes("schedule") || lowerMsg.includes("lecture") || lowerMsg.includes("d3") || lowerMsg.includes("batch");
        const selection = await executeWithFailover({
            messages: [{ role: 'system', content: `Context IDs. JSON: {"docIds": [], "noteIds": []}. Docs: ${JSON.stringify(availableDocs)}` }, { role: 'user', content: userMessage }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        let { docIds } = JSON.parse(selection.choices[0].message.content);
        if (forcePDF && availableDocs.length > 0) docIds = [availableDocs[0].id];
        const relevantDocs = memory.pdfExtractions.filter(d => (docIds || []).includes(d.id)).map(d => ({ filename: d.filename, summary: d.summary, fullContent: d.fullContent }));
        return { docs: relevantDocs, notes: [], profile: memory.profile };
    } catch (err) { return { docs: [], notes: [], profile: memory.profile }; }
};

export const performInternalReview = async (userMessage, context, draftResponse) => {
    try {
        if (!draftResponse) return { status: "FAIL", critique: "Draft is empty." };
        const prompt = `Audit draft. JSON: {"status": "PASS"/"FAIL", "critique": "str"}. Draft: ${draftResponse}`;
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.3-70b-versatile',
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
      const memoryContext = `Docs: ${JSON.stringify(relevantContext.docs)}`;
      const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const messages = [
        { role: 'system', content: `${systemPrompt}\nTime: ${currentTime}\nContext: ${memoryContext}` },
        ...fullMemory.history.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      console.log("[J Brain] Thinking...");
      const completion = await executeWithFailover({ messages, model: 'llama-3.3-70b-versatile', response_format: { type: "json_object" }, temperature: 0.7 });
      const result = JSON.parse(completion.choices[0].message.content);
      let internalThought = result.internal_monologue || "I am processing this request.";
      let finalResponse = result.final_response || "I'm having a bit of trouble connecting to my cognitive centers right now, Boss.";

      console.log("[J Brain] Reviewing...");
      const review = await performInternalReview(userMessage, memoryContext, finalResponse);
      if (review.status === "FAIL") {
          const secondChance = await executeWithFailover({
            messages: [...messages, { role: 'assistant', content: JSON.stringify(result) }, { role: 'system', content: `Error: ${review.critique}. Fix in JSON.` }],
            model: 'llama-3.3-70b-versatile', response_format: { type: "json_object" }, temperature: 0.3
          });
          const fixed = JSON.parse(secondChance.choices[0].message.content);
          internalThought = fixed.internal_monologue || internalThought;
          finalResponse = fixed.final_response || finalResponse;
      }

      if (internalThought) await saveInternalThought(internalThought, "scratchpad");
      if (onChunk && finalResponse) {
          for (const chunk of finalResponse.split(' ')) {
              onChunk(chunk + ' ');
              await new Promise(r => setTimeout(r, 20));
          }
      }
      if (finalResponse) {
          await appendToHistory('user', userMessage);
          await appendToHistory('assistant', finalResponse);
      }
      return finalResponse;
  } catch (error) {
      console.error(`AI Fatal Error:`, error.message);
      if (onChunk) onChunk("I'm sorry, Boss. My cognitive keys are temporarily rate-limited. Please try again in a few minutes.");
      return "Rate limit error.";
  }
};

export const extractPDFInfo = async (text) => {
    try {
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Analyze PDF in JSON: {"summary": "str", "entities": []}.` }, { role: 'user', content: text.substring(0, 30000) }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) { return { summary: "Failed", entities: [], actionItems: [] }; }
};
