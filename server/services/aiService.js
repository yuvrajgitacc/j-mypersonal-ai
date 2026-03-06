import { getMemoryCache, saveMemory, saveNote, saveReminder, logUserMood, getAssociativeContext, saveLongTermFact, getRelationshipStats, getUnspokenThoughts, getRecentJournals, markThoughtAsShared, appendToHistory } from './memoryService.js';
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
    const wantsThoughts = lowerMsg.includes("thought") || lowerMsg.includes("thinking") || lowerMsg.includes("diary") || lowerMsg.includes("monologue") || lowerMsg.includes("soch");
    
    if (wantsThoughts) {
        const thoughts = await getUnspokenThoughts(2);
        const journals = await getRecentJournals(1);
        
        let context = "\n[J'S SECRET KNOWLEDGE (Share only if relevant)]\n";
        if (thoughts.length > 0) {
            context += `Recent Unspoken Thoughts: ${JSON.stringify(thoughts)}\n`;
            // Mark the first one as potentially shared so J doesn't repeat it
            await markThoughtAsShared(thoughts[0].id);
        }
        if (journals.length > 0) {
            context += `Last Private Journal Excerpt: ${journals[0].content.substring(0, 300)}...\n`;
        }
        return context;
    }
    return "";
};

/**
 * NEW: Associative Memory Linker
 * Scans past interactions to find relevant "themes" or "parallels"
 */
export const findAssociativeLinks = async (userMessage) => {
    try {
        const context = await getAssociativeContext();
        const client = getClient();
        
        const prompt = `
            You are J's associative memory module. 
            User's Current Message: "${userMessage}"

            Past History (Summarized): ${JSON.stringify(context.recentHistory.slice(-15))}
            Past Long-Term Facts: ${JSON.stringify(context.longTermFacts)}
            Recent Notes: ${JSON.stringify(context.recentNotes)}

            Task: 
            Identify if there is a meaningful link between the current message and ANY past event, note, or fact. 
            If a link exists, describe it briefly (e.g., "User previously mentioned X which had a similar vibe to Y").
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
        const availableDocs = memory.pdfExtractions.map(d => ({ id: d.id, filename: d.filename }));
        const availableNotes = (memory.notes || []).slice(0, 20).map(n => ({ id: n.id, text: n.text.substring(0, 50) }));

        const selection = await client.chat.completions.create({
            messages: [
                { 
                    role: 'system', 
                    content: `You are a context-retrieval engine. Analyze the user's message and identify which documents or notes are relevant. 
                    Available Docs: ${JSON.stringify(availableDocs)}
                    Available Notes: ${JSON.stringify(availableNotes)}
                    Return JSON: {"docIds": [], "noteIds": []}. Only include IDs if they are truly relevant to answering the query.` 
                },
                { role: 'user', content: userMessage }
            ],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });

        const { docIds, noteIds } = JSON.parse(selection.choices[0].message.content);
        
        const relevantDocs = memory.pdfExtractions
            .filter(d => (docIds || []).includes(d.id))
            .map(d => ({
                filename: d.filename,
                summary: d.summary,
                fullDetails: d.entities // This now contains the full date-mapped list
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

export const generateAIResponse = async (userMessage, onChunk, onReminderSaved) => {
  const fullMemory = await getMemoryCache();
  const relationshipStats = await getRelationshipStats();
  
  // 1. Context Retrieval
  const relevantContext = await getRelevantContext(userMessage, fullMemory);

  // 2. Associative Memory Linking (NEW)
  const associativeLink = await findAssociativeLinks(userMessage);

  // 3. Link Research / YouTube Summarization (NEW)
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

  // 6. Secret Thoughts & Diary Check (NEW)
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
    { role: 'system', content: `${systemPrompt}\n\n[REAL-TIME CONTEXT]\nCurrent Time: ${currentTime}\nDETECTED USER MOOD: ${currentMood}\n\n${memoryContext}` },
    ...recentHistory.map(m => ({ role: m.role, content: m.content }))
  ];

  let attempt = 0;
  
  while (attempt < 2) {
    try {
      const client = getClient();
      const stream = await client.chat.completions.create({
        messages,
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        stream: true,
      });

      let fullResponse = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullResponse += content;
        if (onChunk && content) {
          onChunk(content);
        }
      }
      
      const lowerMsg = userMessage.toLowerCase();

      // Save interaction to history
      await appendToHistory('user', userMessage);
      await appendToHistory('assistant', fullResponse);

      // NEW: Manual Journaling Trigger Detection
      const userAskedToJournal = lowerMsg.includes("write your diary") || lowerMsg.includes("diary likh lo") || lowerMsg.includes("reflect on the day") || lowerMsg.includes("journaling shuru karo");
      if (userAskedToJournal) {
          console.log("DEBUG: User manually triggered journaling.");
          await manualTriggerJournaling();
      }

      // NEW: Send EXISTING journal via Email upon request
      const userAskedToEmailDiary = (lowerMsg.includes("email") || lowerMsg.includes("mail")) && (lowerMsg.includes("diary") || lowerMsg.includes("journal"));
      if (userAskedToEmailDiary) {
          const journals = await getRecentJournals(1);
          if (journals.length > 0) {
              console.log("DEBUG: User requested existing journal via email.");
              await sendJournalEmail(journals[0].date, journals[0].content, journals[0].mood_tone);
          }
      }

      // NEW: Distill new long-term facts after conversation
      if (fullResponse.length > 100) {
          const factDistiller = await client.chat.completions.create({
              messages: [
                  { role: 'system', content: 'Extract any new important facts or topics from this exchange for long-term memory. Return JSON: {"fact": "string", "category": "string"} or {"fact": null} if nothing important.' },
                  { role: 'user', content: `User: ${userMessage}\nJ: ${fullResponse}` }
              ],
              model: 'llama-3.1-8b-instant',
              response_format: { type: "json_object" },
              temperature: 0.1
          });
          const distilled = JSON.parse(factDistiller.choices[0].message.content);
          if (distilled.fact) {
              await saveLongTermFact(distilled.fact, distilled.category);
          }
      }

      const lowerResponse = fullResponse.toLowerCase();

      // --- INTELLIGENT NOTIFICATION TRIGGER (Strictly AI Intent) ---
      const aiWantsToNotify = fullResponse.includes("📱 J Notification Center");

      if (aiWantsToNotify) {
          console.log("DEBUG: AI explicitly requested a phone notification.");
          let notificationTitle = "A Message from J Secretary";
          const titleMatch = fullResponse.match(/📱 J Notification Center:\s*([^:\n]+):/);
          if (titleMatch && titleMatch[1]) {
              notificationTitle = titleMatch[1].trim();
          }
          await sendNotificationToCenter(notificationTitle, fullResponse, "chat");
      }

      // --- INTELLIGENT EMAIL TRIGGER (Strictly AI Intent) ---
      const aiWantsToEmail = lowerResponse.includes("email sent") || lowerResponse.includes("sending an email");

      if (aiWantsToEmail) {
          console.log("DEBUG: Email trigger detected in AI response...");
          const emailSubject = `Update from J Secretary: ${fullMemory.profile.name}`;
          const emailHtml = `
            <div style="font-family: sans-serif; padding: 30px; color: #333; max-width: 600px; border: 1px solid #eee; border-radius: 15px; margin: auto;">
                <h2 style="color: #3b82f6;">Hi ${fullMemory.profile.name}! 👋</h2>
                <div style="background: #f9fafb; padding: 20px; border-radius: 12px; margin: 20px 0; line-height: 1.6;">
                    ${fullResponse.replace(/\n/g, '<br>')}
                </div>
                <p style="font-weight: bold; color: #3b82f6;">— J (Your AI Companion)</p>
            </div>
          `;
          await sendEmailNotification(emailSubject, fullResponse, emailHtml);
      }

      // --- INTELLIGENT REMINDER EXTRACTION ---
      const futureIntent = lowerMsg.includes("remind me to") || lowerMsg.includes("in ") || lowerMsg.includes("at ") || lowerMsg.includes("tomorrow") || lowerResponse.includes("i will notify") || lowerResponse.includes("i'll remind");
      
      if (futureIntent) {
        try {
            console.log("DEBUG: Future reminder intent detected. Extracting...");
            const timeExtraction = await client.chat.completions.create({
                messages: [
                    { 
                        role: 'system', 
                        content: `You are a precision time-extraction engine. 
                        Current Time: ${currentTime}
                        
                        Task: Extract the event and the INTENDED FUTURE time.
                        Rules:
                        1. If the user or J mentions a specific delay (e.g., "in 5 minutes") or time ("tomorrow at 10 AM"), calculate the exact ISO timestamp.
                        2. If NO SPECIFIC future time or delay is mentioned, return {"event": null, "time": null}.
                        3. Do NOT extract reminders for past events or current status updates.
                        4. Return JSON: {"event": "string", "time": "ISO_TIMESTAMP", "confidence": 0-1}.` 
                    },
                    { role: 'user', content: `User said: "${userMessage}"\nJ responded: "${fullResponse}"` }
                ],
                model: 'llama-3.1-8b-instant',
                response_format: { type: "json_object" },
                temperature: 0.1
            });

            const reminderData = JSON.parse(timeExtraction.choices[0].message.content);
            if (reminderData.time && reminderData.event && reminderData.confidence > 0.8) {
                const rTime = new Date(reminderData.time);
                const now = new Date();
                
                // Only save if it's at least 30 seconds into the future to avoid loops
                if (rTime.getTime() > now.getTime() + 30000) {
                    console.log(`✅ Automated Reminder Saved: ${reminderData.event} at ${reminderData.time}`);
                    await saveReminder(reminderData.event, reminderData.time);
                    if (onReminderSaved) onReminderSaved(reminderData);
                }
            }
        } catch (e) {
            console.error("Reminder extraction failed:", e);
        }
      }

      // Fallback for simple "remember this" (No time mentioned)
      if (lowerMsg.includes("remember") && !futureIntent) {
          await saveNote(userMessage);
      }

      return fullResponse;
    } catch (error) {
      console.error(`Error with Groq API Key ${currentClientIndex + 1}:`, error.message);
      if (error.status === 429 || error.status >= 500 || error.message.includes('rate limit')) {
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
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        });
        const result = JSON.parse(completion.choices[0].message.content);
        return Array.isArray(result) ? result : (result.events || []);
    } catch (err) {
        return [];
    }
};
