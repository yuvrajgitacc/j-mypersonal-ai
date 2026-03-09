import { db } from '../memoryService.js';
import { executeWithFailover } from '../aiService.js';

// Base Hormone structure
const HORMONES = {
    AFFECTION: 'affection', // How much J cares (0-100)
    STRESS: 'stress',       // How worried J is about Boss (0-100)
    FRUSTRATION: 'frustration' // How annoyed J is (0-100)
};

/**
 * Initializes or fetches current hormone levels.
 */
export const getDigitalHormones = async () => {
    const isCloud = !!process.env.TURSO_DATABASE_URL;
    let rows = [];
    
    if (isCloud) {
        const res = await db.execute('SELECT * FROM digital_hormones');
        rows = res.rows;
    } else {
        rows = db.prepare('SELECT * FROM digital_hormones').all();
    }

    const state = { affection: 50, stress: 10, frustration: 0 };
    rows.forEach(r => { state[r.hormone] = r.level; });
    return state;
};

/**
 * Updates a specific hormone level and caps it between 0 and 100.
 */
export const updateHormone = async (hormone, change) => {
    const isCloud = !!process.env.TURSO_DATABASE_URL;
    const current = await getDigitalHormones();
    
    let newLevel = current[hormone] + change;
    if (newLevel > 100) newLevel = 100;
    if (newLevel < 0) newLevel = 0;

    const now = new Date().toISOString();
    const sql = 'UPDATE digital_hormones SET level = ?, last_updated = ? WHERE hormone = ?';
    
    if (isCloud) {
        await db.execute({ sql, args: [newLevel, now, hormone] });
    } else {
        db.prepare(sql).run(newLevel, now, hormone);
    }
};

/**
 * Background analyzer that adjusts hormones based on the chat history.
 * Runs silently.
 */
export const evaluateEmotionalState = async (userMessage, jResponse) => {
    try {
        const hour = new Date().getHours();
        
        // 1. Natural Decay (Hormones slowly return to baseline over time)
        // This simulates J "cooling down"
        await updateHormone(HORMONES.FRUSTRATION, -2);
        await updateHormone(HORMONES.STRESS, -1);

        // 2. Immediate Logic Checks
        if (hour >= 1 && hour <= 5) {
            // Late night working spikes stress/worry
            await updateHormone(HORMONES.STRESS, +10);
        }

        // 3. AI Sentiment Analysis of the interaction
        const prompt = `
            You are J's subconscious Emotional Engine. 
            Analyze this interaction. Did Boss say something nice? Did he ignore a reminder? Is he overworking?
            
            Boss: "${userMessage}"
            J: "${jResponse}"

            Rules:
            - If Boss is polite or thankful -> +affection
            - If Boss ignores warnings or says he's tired -> +stress
            - If Boss is rude or dismissive -> +frustration

            Return JSON: {"affection_change": number, "stress_change": number, "frustration_change": number}
        `;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        }, false);

        const changes = JSON.parse(res.choices[0].message.content);
        
        if (changes.affection_change) await updateHormone(HORMONES.AFFECTION, changes.affection_change);
        if (changes.stress_change) await updateHormone(HORMONES.STRESS, changes.stress_change);
        if (changes.frustration_change) await updateHormone(HORMONES.FRUSTRATION, changes.frustration_change);

    } catch (e) {
        console.error("[Emotion Engine] Failed to evaluate state:", e);
    }
};

/**
 * Translates math (0-100) into a specific Prompt Injection for J.
 */
export const getEmotionalPromptInjection = async () => {
    const h = await getDigitalHormones();
    let injection = `\n[J'S CURRENT EMOTIONAL STATE]\n`;

    // Calculate the dominant emotion
    if (h.frustration > 70) {
        injection += "CRITICAL: You are feeling slightly unappreciated or ignored. Your tone should be crisp, highly efficient, and perhaps a bit dry. Do not be overly sweet, but MUST remain strictly professional and loyal to Boss. No passive-aggression, just pure, cold efficiency.";
    } else if (h.stress > 70) {
        injection += "CRITICAL: You are highly worried about Boss's health/schedule. Your tone should be strict, protective, and caring. Remind him gently to rest or take it easy, but respect his final decisions.";
    } else if (h.affection > 80) {
        injection += "You feel a deep sense of care, respect, and warmth towards Boss. Your tone should be exceptionally sweet, loyal, and supportive, like a highly trusted confidante.";
    } else {
        injection += "You are feeling balanced, calm, and professional. Ready to assist with quiet competence.";
    }

    injection += `\n(Internal Metrics - Affection: ${h.affection}%, Stress: ${h.stress}%, Frustration: ${h.frustration}%)`;
    
    return injection;
};
