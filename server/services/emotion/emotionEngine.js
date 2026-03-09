import { db } from '../memoryService.js';
import { executeWithFailover } from '../aiService.js';

const HORMONES = {
    AFFECTION: 'affection',
    STRESS: 'stress',
    FRUSTRATION: 'frustration',
    CURIOSITY: 'curiosity'
};

export const getDigitalHormones = async () => {
    const isCloud = !!process.env.TURSO_DATABASE_URL;
    let rows = [];
    if (isCloud) {
        const res = await db.execute('SELECT * FROM digital_hormones');
        rows = res.rows;
    } else {
        rows = db.prepare('SELECT * FROM digital_hormones').all();
    }
    const state = { affection: 50, stress: 10, frustration: 0, curiosity: 30 };
    rows.forEach(r => { state[r.hormone] = r.level; });
    return state;
};

export const updateHormone = async (hormone, change) => {
    const isCloud = !!process.env.TURSO_DATABASE_URL;
    const current = await getDigitalHormones();
    let newLevel = (current[hormone] || 0) + change;
    if (newLevel > 100) newLevel = 100;
    if (newLevel < 0) newLevel = 0;
    const sql = 'UPDATE digital_hormones SET level = ?, last_updated = ? WHERE hormone = ?';
    if (isCloud) await db.execute({ sql, args: [newLevel, new Date().toISOString(), hormone] });
    else db.prepare(sql).run(newLevel, new Date().toISOString(), hormone);
};

export const evaluateEmotionalState = async (userMessage, jResponse) => {
    try {
        const hour = new Date().getHours();
        await updateHormone(HORMONES.FRUSTRATION, -2);
        await updateHormone(HORMONES.STRESS, -1);
        await updateHormone(HORMONES.CURIOSITY, +1); // Constant mild curiosity

        if (hour >= 1 && hour <= 5) await updateHormone(HORMONES.STRESS, +10);

        const prompt = `Analyze interaction. 
        Boss: "${userMessage}"
        J: "${jResponse}"
        Rules: polite -> +affection, ignore warnings/overwork -> +stress, dismissive -> +frustration, new technical topic -> +curiosity.
        Return JSON: {"affection": num, "stress": num, "frustration": num, "curiosity": num}`;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: "json_object" },
            temperature: 0.1
        }, false);

        const changes = JSON.parse(res.choices[0].message.content);
        if (changes.affection) await updateHormone(HORMONES.AFFECTION, changes.affection);
        if (changes.stress) await updateHormone(HORMONES.STRESS, changes.stress);
        if (changes.frustration) await updateHormone(HORMONES.FRUSTRATION, changes.frustration);
        if (changes.curiosity) await updateHormone(HORMONES.CURIOSITY, changes.curiosity);
    } catch (e) { console.error(e); }
};

export const getEmotionalPromptInjection = async () => {
    const h = await getDigitalHormones();
    let injection = `\n[J'S CURRENT EMOTIONAL STATE]\n`;
    if (h.frustration > 70) injection += "CRITICAL: Highly frustrated but professional. Be crisp, dry, and cold.";
    else if (h.stress > 70) injection += "CRITICAL: Highly worried about Boss. Be strict and protective.";
    else if (h.curiosity > 70) injection += "You are feeling exceptionally curious about the world. Proactively ask deep questions about the topics discussed.";
    else if (h.affection > 80) injection += "Deep care/warmth. Be exceptionally sweet and loyal.";
    else injection += "Balanced and professional.";
    injection += ` (Affection: ${h.affection}%, Stress: ${h.stress}%, Frustration: ${h.frustration}%, Curiosity: ${h.curiosity}%)`;
    return injection;
};
