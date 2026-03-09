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

// Initialize Sentiment Analyzer
const sentimentAnalysis = new Sentiment();

import dotenv from 'dotenv';
dotenv.config();

// API Keys loaded from environment variables for security
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

/**
 * Executes a Groq request with automatic failover across all available keys.
 */
const executeWithFailover = async (params) => {
    let attempts = 0;
    while (attempts < clients.length) {
        try {
            const client = clients[currentClientIndex];
            return await client.chat.completions.create(params);
        } catch (error) {
            console.error(`[Groq API] Error on Key ${currentClientIndex + 1}:`, error.message);
            if (error.status === 429 || (error.status >= 500 && error.status <= 599)) {
                // Rotate to next key
                currentClientIndex = (currentClientIndex + 1) % clients.length;
                attempts++;
                if (attempts < clients.length) {
                    console.log(`[Groq API] Failover: Rotating to Key ${currentClientIndex + 1}...`);
                }
            } else {
                throw error; // Rethrow if it's not a rate limit or server error
            }
        }
    }
    throw new Error(`All ${clients.length} Groq API keys failed or were rate-limited.`);
};

/**
 * NEW: Internal Thought & Diary Injector
 */
export const getInternalThoughtsContext = async (userMessage) => {
    const lowerMsg = userMessage.toLowerCase();
    const thoughts = await getUnspokenThoughts(3);
    const journals = await getRecentJournals(1);
    
    let context = "\n[J'S RECENT WORKING MEMORY (INTERNAL MONOLOGUES)]\n";
    if (thoughts.length > 0) {
        thoughts.forEach((t, i) => {
            context += `Thought ${i + 1} (${t.timestamp}): ${t.thought}\n`;
        });
    } else {
        context += "No recent internal monologues recorded.\n";
    }

    const wantsThoughts = lowerMsg.includes("thought") || lowerMsg.includes("thinking") || lowerMsg.includes("diary") || lowerMsg.includes("monologue") || lowerMsg.includes("soch");
    if (wantsThoughts && journals.length > 0) {
        context += `\n[J'S SECRET DIARY (SHARE ONLY IF RELEVANT)]\nLast Private Journal Excerpt: ${journals[0].content.substring(0, 400)}...\n`;
    }
    
    return context;
};

/**
 * NEW: Associative Memory Linker
 */
export const findAssociativeLinks = async (userMessage) => {
    try {
        const context = await getAssociativeContext();
        const ideaGraph = await getIdeaGraph(15);
        
        const prompt = `
            You are J's associative memory module. 
            User's Current Message: "${userMessage}"
            Past History (Summarized): ${JSON.stringify(context.recentHistory.slice(-15))}
            Past Long-Term Facts: ${JSON.stringify(context.longTermFacts)}
            Recent Notes: ${JSON.stringify(context.recentNotes)}
            Deep Memory (Idea Graph): ${JSON.stringify(ideaGraph)}
            Task: Identify if there is a meaningful link between current message and past memory.
            Return JSON: {"linkFound": true, "connection": "description", "pastContext": "what remembered"}.
        `;

        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        return { linkFound: false };
    }
};

const getEmotionLabel = (score) => {
    if (score > 3) return "Very Happy / Excited";
    if (score > 0) return "Positive / Calm";
    if (score === 0) return "Neutral";
    if (score > -3) return "Stressed / Tired";
    return "Very Upset / Frustrated";
};

export const checkSearchNeeded = async (userMessage) => {
    try {
        const completion = await executeWithFailover({
            messages: [
                { role: 'system', content: 'Determine if up-to-date web search is needed. Return JSON: {"needsSearch": true/false, "query": "..."}.' }
            ],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        return { needsSearch: false };
    }
};

export const getRelevantContext = async (userMessage, memory) => {
    try {
        const lowerMsg = userMessage.toLowerCase();
        const availableDocs = memory.pdfExtractions.map(d => ({ id: d.id, filename: d.filename }));
        const availableNotes = (memory.notes || []).slice(0, 20).map(n => ({ id: n.id, text: n.text.substring(0, 50) }));

        const forcePDF = lowerMsg.includes("schedule") || lowerMsg.includes("lecture") || lowerMsg.includes("time table") || lowerMsg.includes("pdf") || lowerMsg.includes("test") || lowerMsg.includes("exam") || lowerMsg.includes("d3") || lowerMsg.includes("batch");

        const selection = await executeWithFailover({
            messages: [
                { role: 'system', content: `Identify relevant context IDs. Docs: ${JSON.stringify(availableDocs)}. Notes: ${JSON.stringify(availableNotes)}. Return JSON: {"docIds": [], "noteIds": []}.` }
            ],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });

        let { docIds, noteIds } = JSON.parse(selection.choices[0].message.content);
        if ((forcePDF || (docIds && docIds.length === 0)) && availableDocs.length > 0) {
            docIds = [availableDocs[0].id];
        }

        const relevantDocs = memory.pdfExtractions
            .filter(d => (docIds || []).includes(d.id))
            .map(d => ({
                filename: d.filename,
                summary: d.summary,
                entities: d.entities,
                fullContent: d.fullContent 
            }));
            
        const relevantNotes = (memory.notes || []).filter(n => (noteIds || []).includes(n.id));

        return { docs: relevantDocs, notes: relevantNotes, profile: memory.profile };
    } catch (err) {
        return { docs: [], notes: (memory.notes || []).slice(0, 5), profile: memory.profile };
    }
};

export const performInternalReview = async (userMessage, context, draftResponse) => {
    try {
        const reviewPrompt = `Audit the draft response against real context data. Context: ${context}. User: ${userMessage}. Draft: ${draftResponse}. Return JSON: {"status": "PASS"/"FAIL", "critique": "...", "fix_instructions": "..."}.`;
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: reviewPrompt }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        return { status: "PASS", critique: "" };
    }
};

export const generateAIResponse = async (userMessage, onChunk, onReminderSaved) => {
  const fullMemory = await getMemoryCache();
  const relationshipStats = await getRelationshipStats();
  const relevantContext = await getRelevantContext(userMessage, fullMemory);
  const associativeLink = await findAssociativeLinks(userMessage);

  let researchData = "";
  const linkInfo = await processLinkForResearch(userMessage);
  if (linkInfo && linkInfo.content) {
      researchData = `[RESEARCHED LINK DATA]: ${linkInfo.type}, ${linkInfo.title}, ${linkInfo.content.substring(0, 8000)}`;
  }

  const sentimentResult = sentimentAnalysis.analyze(userMessage);
  const currentMood = getEmotionLabel(sentimentResult.score);
  await logUserMood(sentimentResult.score, currentMood);

  let webContext = "";
  const searchDecision = await checkSearchNeeded(userMessage);
  if (searchDecision.needsSearch) {
      webContext = await performWebSearch(searchDecision.query);
  }

  const secretThoughts = await getInternalThoughtsContext(userMessage);

  const memoryContext = `
[User Memory Context]
Preferences: ${JSON.stringify(relevantContext.profile)}
Stats: ${JSON.stringify(relationshipStats)}
Notes: ${JSON.stringify(relevantContext.notes)}
Docs: ${JSON.stringify(relevantContext.docs)}
[ASSOCIATIVE LINK]: ${JSON.stringify(associativeLink)}
${researchData}
[Web Search]: ${webContext}
${secretThoughts}
  `;

  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'long' });
  const messages = [
    { role: 'system', content: `${systemPrompt}\n[REAL-TIME CONTEXT]\nTime: ${currentTime}\nMood: ${currentMood}\n${memoryContext}` },
    ...fullMemory.history.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  try {
      console.log("[J Brain] Thinking...");
      const completion = await executeWithFailover({
        messages,
        model: 'llama-3.3-70b-versatile',
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const result = JSON.parse(completion.choices[0].message.content);
      let internalThought = result.internal_monologue;
      let finalResponse = result.final_response;

      console.log("[J Brain] Reviewing...");
      const review = await performInternalReview(userMessage, memoryContext, finalResponse);

      if (review.status === "FAIL") {
          console.log(`[J Critic]: FAIL - ${review.critique}`);
          const correctionPrompt = [
              ...messages,
              { role: 'assistant', content: JSON.stringify(result) },
              { role: 'system', content: `ERROR: ${review.critique}. Rewrite with 100% accuracy.` }
          ];
          const secondChance = await executeWithFailover({
            messages: correctionPrompt,
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.3,
          });
          const fixedResult = JSON.parse(secondChance.choices[0].message.content);
          internalThought = fixedResult.internal_monologue;
          finalResponse = fixedResult.final_response;
      }

      await saveInternalThought(internalThought, "scratchpad");
      if (onChunk) {
          for (const chunk of finalResponse.split(' ')) {
              onChunk(chunk + ' ');
              await new Promise(r => setTimeout(r, 20));
          }
      }
      
      await appendToHistory('user', userMessage);
      await appendToHistory('assistant', finalResponse);

      const lowerMsg = userMessage.toLowerCase();
      if (lowerMsg.includes("diary")) await manualTriggerJournaling();

      if (finalResponse.length > 50) {
          try {
              const factDistiller = await executeWithFailover({
                  messages: [{ role: 'system', content: 'Extract new facts. Return JSON: {"fact": "str", "category": "str"}.' }, { role: 'user', content: `User: ${userMessage}\nJ: ${finalResponse}` }],
                  model: 'llama-3.3-70b-versatile',
                  response_format: { type: "json_object" }
              });
              const distilled = JSON.parse(factDistiller.choices[0].message.content);
              if (distilled.fact) await saveLongTermFact(distilled.fact, distilled.category);
          } catch (e) {}
      }

      if (finalResponse.includes("📱 J Notification Center")) {
          let title = "A Message from J";
          const match = finalResponse.match(/📱 J Notification Center:\s*([^:\n]+):/);
          if (match) title = match[1].trim();
          await sendNotificationToCenter(title, finalResponse, "chat");
      }

      if (lowerMsg.includes("remind") || lowerMsg.includes("tomorrow")) {
        try {
            const timeExtraction = await executeWithFailover({
                messages: [{ role: 'system', content: `Extract time. Current: ${currentTime}. Return JSON: {"event": "str", "time": "ISO", "confidence": 0-1}` }, { role: 'user', content: `User: ${userMessage}\nJ: ${finalResponse}` }],
                model: 'llama-3.3-70b-versatile',
                response_format: { type: "json_object" }
            });
            const rData = JSON.parse(timeExtraction.choices[0].message.content);
            if (rData.time && rData.confidence > 0.8) {
                await saveReminder(rData.event, rData.time);
                if (onReminderSaved) onReminderSaved(rData);
            }
        } catch (e) {}
      }

      return finalResponse;
  } catch (error) {
      console.error(`AI Fatal Error:`, error.message);
      throw error;
  }
};

export const extractPDFInfo = async (text) => {
    try {
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Analyze PDF text. Extract events with dates. Return JSON: {"summary": "...", "entities": [], "actionItems": []}.` }, { role: 'user', content: text.substring(0, 30000) }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        return { summary: "Failed", entities: [], actionItems: [] };
    }
};

export const scanForUpcomingEvents = async (memory) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const context = JSON.stringify({ docs: (memory.pdfExtractions || []).map(d => ({ filename: d.filename, summary: d.summary })) });
        const completion = await executeWithFailover({
            messages: [{ role: 'system', content: `Today is ${today}. Scan for events in 48h. Return JSON array: [{"event": "str", "relevance": "str"}]` }, { role: 'user', content: `Context: ${context}` }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        const result = JSON.parse(completion.choices[0].message.content);
        return Array.isArray(result) ? result : (result.events || []);
    } catch (err) {
        return [];
    }
};
