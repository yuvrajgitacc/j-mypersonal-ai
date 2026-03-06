import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { getMemoryCache, getAssociativeContext, saveIdeaConnection, saveInternalThought } from './memoryService.js';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY_1 });

export const processSleepCycle = async () => {
    console.log("[J Sleep Cycle] Entering deep sleep. Synthesizing True Memory (Idea Graph)...");
    
    try {
        const memory = await getMemoryCache();
        const context = await getAssociativeContext();
        
        // Grab recent data to synthesize
        const recentHistory = context.recentHistory.slice(-50); // Last 50 interactions
        const recentNotes = context.recentNotes.slice(-20); // Last 20 notes
        
        if (recentHistory.length === 0 && recentNotes.length === 0) {
            console.log("[J Sleep Cycle] No new data to synthesize. Resting.");
            return;
        }

        const prompt = `
            You are J's subconscious mind. Your job is to perform "Memory Synthesis".
            Look at the following interactions and notes from the user's day.
            Your goal is to build an "Idea Graph". Connect different concepts, subjects, or facts that were mentioned.
            For example: If the user studied "TOC" and mentioned "Python" in the same context, create a connection.
            
            [RECENT HISTORY]
            ${JSON.stringify(recentHistory)}
            
            [RECENT NOTES]
            ${JSON.stringify(recentNotes)}
            
            Return a JSON array of connections. Only return high-confidence, meaningful connections that help you understand the user better.
            Format:
            {
                "connections": [
                    {
                        "concept_a": "TOC",
                        "concept_b": "Python",
                        "relationship": "Both are subjects Yuvraj is studying for Test-1"
                    }
                ]
            }
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant', // Fast and good for structured data extraction
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        const result = JSON.parse(completion.choices[0].message.content);
        
        if (result.connections && Array.isArray(result.connections) && result.connections.length > 0) {
            console.log(`[J Sleep Cycle] Formed ${result.connections.length} new neural connections.`);
            for (const conn of result.connections) {
                await saveIdeaConnection(conn.concept_a, conn.concept_b, conn.relationship);
            }
            await saveInternalThought(`I dreamed about Yuvraj's projects and formed new connections: ${result.connections.map(c => c.concept_a + ' <-> ' + c.concept_b).join(', ')}.`, "sleep_cycle");
        } else {
            console.log("[J Sleep Cycle] No meaningful new connections formed tonight.");
        }

    } catch (err) {
        console.error("[J Sleep Cycle] Error during memory synthesis:", err);
    }
};
