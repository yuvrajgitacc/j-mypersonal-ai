import { db, saveLongTermFact } from './memoryService.js';
import { executeWithFailover } from './aiService.js';
import path from 'path';

import dotenv from 'dotenv';
dotenv.config();

/**
 * Monthly Cleanup:
 * 1. Finds chat logs older than 30 days.
 * 2. Distills important facts from them into long-term memory.
 * 3. Deletes the raw logs.
 */
export const runMonthlyCleanup = async () => {
    console.log("Starting monthly memory cleanup and distillation...");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    // Check if cloud or local
    const isCloud = !!process.env.TURSO_DATABASE_URL;

    // 1. Get old messages
    let oldMessages = [];
    if (isCloud) {
        const res = await db.execute({
            sql: "SELECT * FROM chat_history WHERE timestamp < ?",
            args: [dateStr]
        });
        oldMessages = res.rows;
    } else {
        oldMessages = db.prepare("SELECT * FROM chat_history WHERE timestamp < ?").all(dateStr);
    }

    if (oldMessages.length === 0) {
        console.log("No old messages to clean up.");
        return;
    }

    try {
        // 2. Distill the "essence" before deleting
        const groupedByDay = {};
        oldMessages.forEach(m => {
            const day = m.timestamp.split('T')[0];
            if (!groupedByDay[day]) groupedByDay[day] = "";
            groupedByDay[day] += `${m.role}: ${m.content}\n`;
        });

        for (const [day, text] of Object.entries(groupedByDay)) {
            const prompt = `
                You are J's long-term memory architect. 
                Below is a chat log from ${day}. 
                Extract any crucial long-term facts, life updates, or project progress that MUST be remembered forever.
                Return JSON: {"fact": "distilled important fact", "category": "projects/personal/life"} or {"fact": null}.
            `;

            const completion = await executeWithFailover({
                messages: [{ role: 'system', content: prompt }, { role: 'user', content: text.substring(0, 10000) }],
                model: 'llama-3.1-8b-instant',
                response_format: { type: "json_object" },
                temperature: 0.1
            });

            const result = JSON.parse(completion.choices[0].message.content);
            if (result.fact) {
                await saveLongTermFact(result.fact, result.category);
            }
        }

        // 3. Delete raw logs
        if (isCloud) {
            await db.execute({
                sql: "DELETE FROM chat_history WHERE timestamp < ?",
                args: [dateStr]
            });
        } else {
            db.prepare("DELETE FROM chat_history WHERE timestamp < ?").run(dateStr);
        }
        console.log(`Cleaned up ${oldMessages.length} old chat logs and preserved key facts.`);

    } catch (err) {
        console.error("Cleanup/Distillation Error:", err);
    }
};