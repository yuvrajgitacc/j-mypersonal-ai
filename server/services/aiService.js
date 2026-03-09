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
    getIdeaGraph // Added getIdeaGraph
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
const KEY_1 = process.env.GROQ_API_KEY_1;
const KEY_2 = process.env.GROQ_API_KEY_2;

const groq1 = new Groq({ apiKey: KEY_1 });
const groq2 = new Groq({ apiKey: KEY_2 });

let currentClientIndex = 0; // 0 for KEY_1, 1 for KEY_2
const clients = [groq1, groq2];

const getClient = () => clients[currentClientIndex];

/**
 * NEW: Internal Thought & Diary Injector
 */
export const getInternalThoughtsContext = async (userMessage) => {
    const lowerMsg = userMessage.toLowerCase();
    
    // Always fetch last 3 thoughts for "working memory"
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

    // Still check if the user specifically asked for her "feelings" or "diary"
    const wantsThoughts = lowerMsg.includes("thought") || lowerMsg.includes("thinking") || lowerMsg.includes("diary") || lowerMsg.includes("monologue") || lowerMsg.includes("soch");
    if (wantsThoughts && journals.length > 0) {
        context += `\n[J'S SECRET DIARY (SHARE ONLY IF RELEVANT)]\nLast Private Journal Excerpt: ${journals[0].content.substring(0, 400)}...\n`;
    }
    
    return context;
};

/**
 * NEW: Associative Memory Linker
 * Scans past interactions to find relevant "themes" or "parallels"
 */
export const findAssociativeLinks = async (userMessage) => {
    try {
        const context = await getAssociativeContext();
        const ideaGraph = await getIdeaGraph(15);
        const client = getClient();
        
        const prompt = `
            You are J's associative memory module. 
            User's Current Message: "${userMessage}"

            Past History (Summarized): ${JSON.stringify(context.recentHistory.slice(-15))}
            Past Long-Term Facts: ${JSON.stringify(context.longTermFacts)}
            Recent Notes: ${JSON.stringify(context.recentNotes)}
            Deep Memory (Idea Graph): ${JSON.stringify(ideaGraph)}

            Task: 
            Identify if there is a meaningful link between the current message and ANY past event, note, or Idea Graph connection. 
            If a link exists, describe it briefly (e.g., "User previously mentioned X which had a similar vibe to Y", or "I remember X is connected to Y because...").
            If NO meaningful link exists, return {"linkFound": false}.
            
            Return JSON: {"linkFound": true, "connection": "description of the link", "pastContext": "what was remembered"}.
            Keep it subtle. Only link if it feels natural, like a human memory.
        `;

        const completion = await client.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        console.error("Associative Linker error:", err);
        return { linkFound: false };
    }
};

/**
 * Helper to determine emotion label based on score
 */
const getEmotionLabel = (score) => {
    if (score > 3) return "Very Happy / Excited";
    if (score > 0) return "Positive / Calm";
    if (score === 0) return "Neutral";
    if (score > -3) return "Stressed / Tired";
    return "Very Upset / Frustrated";
};

/**
 * NEW: Decides if a web search is needed for the query.
 */
export const checkSearchNeeded = async (userMessage) => {
    try {
        const client = getClient();
        const completion = await client.chat.completions.create({
            messages: [
                { 
                    role: 'system', 
                    content: 'You are a search decision engine. Analyze the user message and determine if it requires up-to-date real-time information from the internet (news, live scores, current weather, latest tech releases). Return JSON: {"needsSearch": true/false, "query": "optimized search query if true"}.' 
                },
                { role: 'user', content: userMessage }
            ],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        console.error("Search decision error:", err);
        return { needsSearch: false };
    }
};

/**
 * FLAW 2 FIX: Selective Context Retrieval (RAG-lite)
 */
export const getRelevantContext = async (userMessage, memory) => {
    try {
        const client = getClient();
        const lowerMsg = userMessage.toLowerCase();
        const availableDocs = memory.pdfExtractions.map(d => ({ id: d.id, filename: d.filename }));
        const availableNotes = (memory.notes || []).slice(0, 20).map(n => ({ id: n.id, text: n.text.substring(0, 50) }));

        // FORCE PDF LOAD if user mentions schedule-related keywords
        const forcePDF = lowerMsg.includes("schedule") || lowerMsg.includes("lecture") || lowerMsg.includes("time table") || lowerMsg.includes("pdf") || lowerMsg.includes("test") || lowerMsg.includes("exam") || lowerMsg.includes("d3") || lowerMsg.includes("batch");

        const selection = await client.chat.completions.create({
            messages: [
                { 
                    role: 'system', 
                    content: `You are a high-level Context-Retrieval Engine. Analyze the user's message and identify which documents or notes are relevant. 
                    Available Docs: ${JSON.stringify(availableDocs)}
                    Available Notes: ${JSON.stringify(availableNotes)}
                    Return JSON: {"docIds": [], "noteIds": []}. 
                    
                    RULE: If the user asks about a schedule, a batch (e.g., D3), a specific date, or a test, you MUST include the relevant PDF IDs.` 
                },
                { role: 'user', content: userMessage }
            ],
            model: 'llama-3.3-70b-versatile', // UPGRADED TO 70B
            response_format: { type: "json_object" },
            temperature: 0.1
        });

        let { docIds, noteIds } = JSON.parse(selection.choices[0].message.content);
        
        // Safety Fallback: If forced or nothing found but docs exist, take the most recent doc
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

        return {
            docs: relevantDocs,
            notes: relevantNotes,
            profile: memory.profile
        };
    } catch (err) {
        console.error("Context retrieval error:", err);
        return { docs: [], notes: (memory.notes || []).slice(0, 5), profile: memory.profile };
    }
};

/**
 * NEW: The Internal Critic (System 2 - Phase 2)
 * Audits the draft response against the real data to catch hallucinations.
 */
export const performInternalReview = async (userMessage, context, draftResponse) => {
    try {
        const client = getClient();
        const reviewPrompt = `
            You are J's Internal Critic (The Logic Auditor). 
            
            [CONTEXT DATA PROVIDED TO J]
            ${context}
            
            [USER'S MESSAGE]
            "${userMessage}"
            
            [J'S DRAFT RESPONSE]
            "${draftResponse}"
            
            TASK:
            1. Compare J's draft against the [CONTEXT DATA].
            2. Check for Hallucinations: Did J mention a meeting, date, or fact NOT in the context?
            3. Check for Tone: Is she being professional and caring?
            
            Return JSON:
            {
                "status": "PASS" | "FAIL",
                "critique": "Describe the error if any",
                "fix_instructions": "Specific instructions for J to correct her draft"
            }
        `;

        const completion = await client.chat.completions.create({
            messages: [{ role: 'system', content: reviewPrompt }],
            model: 'llama-3.3-70b-versatile', // UPGRADED TO 70B
            response_format: { type: "json_object" },
            temperature: 0.1
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        console.error("Internal Critic Error:", err);
        return { status: "PASS", critique: "" }; // Fallback
    }
};

export const generateAIResponse = async (userMessage, onChunk, onReminderSaved) => {
  const fullMemory = await getMemoryCache();
  const relationshipStats = await getRelationshipStats();
  
  // 1. Context Retrieval
  const relevantContext = await getRelevantContext(userMessage, fullMemory);

  // 2. Associative Memory Linking
  const associativeLink = await findAssociativeLinks(userMessage);

  // 3. Link Research / YouTube Summarization
  let researchData = "";
  const linkInfo = await processLinkForResearch(userMessage);
  if (linkInfo && linkInfo.content) {
      researchData = `[RESEARCHED LINK DATA]: Type: ${linkInfo.type}, Title: ${linkInfo.title || "Video Transcript"}, Content: ${linkInfo.content.substring(0, 8000)}`;
  }

  // 4. Sentiment Analysis
  const sentimentResult = sentimentAnalysis.analyze(userMessage);
  const currentMood = getEmotionLabel(sentimentResult.score);
  await logUserMood(sentimentResult.score, currentMood);

  // 5. Web Search Check
  let webContext = "";
  const searchDecision = await checkSearchNeeded(userMessage);
  if (searchDecision.needsSearch) {
      webContext = await performWebSearch(searchDecision.query);
  }

  // 6. Secret Thoughts & Diary Check
  const secretThoughts = await getInternalThoughtsContext(userMessage);

  const memoryContext = `
[User Memory Context]
Preferences: ${JSON.stringify(relevantContext.profile)}
Relationship Stats: ${JSON.stringify(relationshipStats)}
Relevant Notes: ${JSON.stringify(relevantContext.notes)}
Relevant Document Insights: ${JSON.stringify(relevantContext.docs)}
[ASSOCIATIVE LINK]: ${associativeLink.linkFound ? JSON.stringify(associativeLink.connection) : "None detected."}
${researchData}
[Live Web Search Data]: ${webContext || "No web search performed."}
${secretThoughts}
  `;

  const recentHistory = fullMemory.history.slice(-10);

  const currentTime = new Date().toLocaleString('en-IN', { 
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full', 
    timeStyle: 'long' 
  });

  const messages = [
    { 
        role: 'system', 
        content: `${systemPrompt}

[SYSTEM 2 THINKING PROTOCOL]
You MUST process this request in two stages:
1. INTERNAL_MONOLOGUE: Silently analyze the user's message. Cross-reference the [User Memory Context]. Check for dates, facts, and logic errors.
2. FINAL_RESPONSE: The warm, caring, and professional response you send to Yuvraj.

Return JSON format:
{
    "internal_monologue": "Detailed step-by-step reasoning",
    "final_response": "The actual message"
}

[REAL-TIME CONTEXT]
Current Time: ${currentTime}
DETECTED USER MOOD: ${currentMood}

${memoryContext}` 
    },
    ...recentHistory.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  let attempt = 0;
  
  while (attempt < 2) {
    try {
      const client = getClient();
      console.log("[J Brain] Thinking...");
      
      const completion = await client.chat.completions.create({
        messages,
        model: 'llama-3.3-70b-versatile',
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const result = JSON.parse(completion.choices[0].message.content);
      let internalThought = result.internal_monologue;
      let finalResponse = result.final_response;

      // --- PHASE 2: INTERNAL CRITIC LOOP ---
      console.log("[J Brain] Performing Internal Review...");
      const review = await performInternalReview(userMessage, memoryContext, finalResponse);

      if (review.status === "FAIL") {
          console.log(`[J Critic Audit]: FAIL - ${review.critique}`);
          await saveInternalThought(`CRITIC FAILED DRAFT: ${review.critique}`, "critic_alert");
          
          // Force a second attempt with the critique injected
          const correctionPrompt = [
              ...messages,
              { role: 'assistant', content: JSON.stringify(result) },
              { role: 'system', content: `CRITICAL ERROR DETECTED: ${review.critique}. Instruction: ${review.fix_instructions}. Rewrite your response now with 100% accuracy.` }
          ];

          const secondChance = await client.chat.completions.create({
            messages: correctionPrompt,
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.3,
          });

          const fixedResult = JSON.parse(secondChance.choices[0].message.content);
          internalThought = fixedResult.internal_monologue;
          finalResponse = fixedResult.final_response;
          console.log("[J Brain] Draft corrected successfully.");
      } else {
          console.log("[J Critic Audit]: PASS");
      }

      // --- END OF CRITIC LOOP ---

      console.log(`[J Thought]: ${internalThought.substring(0, 100)}...`);

      // Save thought & Stream response
      await saveInternalThought(internalThought, "scratchpad");

      if (onChunk) {
          const chunks = finalResponse.split(' ');
          for (const chunk of chunks) {
              onChunk(chunk + ' ');
              await new Promise(resolve => setTimeout(resolve, 30));
          }
      }
      
      const lowerMsg = userMessage.toLowerCase();

      // Save interaction
      await appendToHistory('user', userMessage);
      await appendToHistory('assistant', finalResponse);

      // Automated Background Tasks
      const userAskedToJournal = lowerMsg.includes("write your diary") || lowerMsg.includes("diary likh lo") || lowerMsg.includes("reflect on the day") || lowerMsg.includes("journaling shuru karo");
      if (userAskedToJournal) await manualTriggerJournaling();

      if (finalResponse.length > 50) {
          const factDistiller = await client.chat.completions.create({
              messages: [
                  { role: 'system', content: 'Extract new facts (like room numbers, project names, preferences). Return JSON: {"fact": "string", "category": "string"} or {"fact": null}.' },
                  { role: 'user', content: `User: ${userMessage}\nJ: ${finalResponse}` }
              ],
              model: 'llama-3.3-70b-versatile', // UPGRADED
              response_format: { type: "json_object" }
          });
          const distilled = JSON.parse(factDistiller.choices[0].message.content);
          if (distilled.fact) await saveLongTermFact(distilled.fact, distilled.category);
      }

      // Notifications
      if (finalResponse.includes("📱 J Notification Center")) {
          let notificationTitle = "A Message from J Secretary";
          const titleMatch = finalResponse.match(/📱 J Notification Center:\s*([^:\n]+):/);
          if (titleMatch && titleMatch[1]) notificationTitle = titleMatch[1].trim();
          await sendNotificationToCenter(notificationTitle, finalResponse, "chat");
      }

      // Reminder Extraction
      const futureIntent = lowerMsg.includes("remind me to") || lowerMsg.includes("in ") || lowerMsg.includes("at ") || lowerMsg.includes("tomorrow");
      if (futureIntent) {
        try {
            const timeExtraction = await client.chat.completions.create({
                messages: [
                    { role: 'system', content: `Extract time. Current: ${currentTime}. Return JSON: {"event": "str", "time": "ISO", "confidence": 0-1}` },
                    { role: 'user', content: `User: ${userMessage}\nJ: ${finalResponse}` }
                ],
                model: 'llama-3.3-70b-versatile', // UPGRADED
                response_format: { type: "json_object" }
            });
            const reminderData = JSON.parse(timeExtraction.choices[0].message.content);
            if (reminderData.time && reminderData.confidence > 0.8) {
                await saveReminder(reminderData.event, reminderData.time);
                if (onReminderSaved) onReminderSaved(reminderData);
            }
        } catch (e) {}
      }

      return finalResponse;
    } catch (error) {
      console.error(`Error with Groq API Key ${currentClientIndex + 1}:`, error.message);
      if (error.status === 429 || error.status >= 500) {
        currentClientIndex = currentClientIndex === 0 ? 1 : 0;
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error("Both API keys failed.");
};

export const extractPDFInfo = async (text) => {
    try {
        const client = getClient();
        const completion = await client.chat.completions.create({
            messages: [
                { 
                    role: 'system', 
                    content: `You are a high-level Document Specialist. 
                    Your task is to analyze raw text extracted from a PDF (likely a table or calendar). 
                    
                    INSTRUCTIONS:
                    1. Identify the TYPE of document (e.g., Academic Calendar, Invoice, Report).
                    2. If it is a CALENDAR, map out columns (Months) and rows (Dates). 
                    3. Extract events with their FULL dates (e.g., "March 30: Test-1 (DM)"). 
                    4. Check for logic: Are the dates in order? Is there a pattern? 
                    
                    Return JSON: {"summary": "A detailed spatial summary of the document", "entities": ["Full event list with dates"], "actionItems" : ["Important tasks/dates extracted"]}.` 
                },
                { role: 'user', content: text.substring(0, 30000) }
            ],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        console.error("PDF Extraction Error:", err);
        return { summary: "Failed to extract", entities: [], actionItems: [] };
    }
};

export const scanForUpcomingEvents = async (memory) => {
    try {
        const client = getClient();
        const today = new Date().toISOString().split('T')[0];
        const context = JSON.stringify({
            notes: (memory.notes || []).slice(0, 50),
            todo: (memory.todo || []),
            docs: (memory.pdfExtractions || []).map(d => ({ filename: d.filename, summary: d.summary }))
        });

        const completion = await client.chat.completions.create({
            messages: [
                { role: 'system', content: `Today is ${today}. Scan for events in 48h. Return JSON array: [{"event": "str", "relevance": "string"}]` },
                { role: 'user', content: `Context: ${context}` }
            ],
            model: 'llama-3.3-70b-versatile', // UPGRADED
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        const result = JSON.parse(completion.choices[0].message.content);
        return Array.isArray(result) ? result : (result.events || []);
    } catch (err) {
        return [];
    }
};
