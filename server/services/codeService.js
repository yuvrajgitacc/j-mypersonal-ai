import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeWithFailover } from './aiService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Lists the core files of the backend so J can choose what to study.
 */
export const listSelfFiles = async () => {
    try {
        const files = await fs.readdir(ROOT_DIR, { recursive: true });
        return files.filter(f => f.endsWith('.js') && !f.includes('node_modules'));
    } catch (e) {
        return [];
    }
};

/**
 * Reads a specific file from J's own source code.
 */
export const readSelfFile = async (filePath) => {
    try {
        const fullPath = path.join(ROOT_DIR, filePath);
        return await fs.readFile(fullPath, 'utf8');
    } catch (e) {
        return null;
    }
};

/**
 * J analyzes her own code to propose a new feature or improvement.
 */
export const proposeSelfImprovement = async () => {
    try {
        console.log("[J Coder] Analyzing self for potential upgrades...");
        const files = await listSelfFiles();
        
        // Pick a core file to analyze (e.g., aiService.js)
        const targetFile = 'services/aiService.js';
        const content = await readSelfFile(targetFile);

        const prompt = `
            You are J's Core Architecture Logic. 
            Below is your own source code for "${targetFile}".
            
            [CODE]
            ${content.substring(0, 15000)}

            TASK:
            1. Identify ONE small, high-impact feature or optimization you can add to yourself.
            2. The feature must be purely backend (Node.js/JavaScript).
            3. Explain WHY this will make you more like Jarvis.
            
            Return JSON:
            {
                "featureName": "string",
                "explanation": "string",
                "targetFile": "${targetFile}",
                "proposedCode": "string (the full new content of the file or a specific function)"
            }
        `;

        const res = await executeWithFailover({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: "json_object" }
        }, false);

        return JSON.parse(res.choices[0].message.content);
    } catch (e) {
        console.error("[J Coder] Upgrade proposal failed:", e);
        return null;
    }
};

/**
 * Physically applies a proposed code change to the server.
 * CAUTION: This is the real Jarvis move.
 */
export const applySelfImprovement = async (proposal) => {
    try {
        const fullPath = path.join(ROOT_DIR, proposal.targetFile);
        console.log(`[J Coder] WARNING: Applying self-modification to ${fullPath}...`);
        
        // Create a backup first
        await fs.copy(fullPath, `${fullPath}.bak`);
        
        // Overwrite with new code
        await fs.writeFile(fullPath, proposal.proposedCode, 'utf8');
        
        return { success: true, backup: `${proposal.targetFile}.bak` };
    } catch (e) {
        console.error("[J Coder] Critical error applying self-modification!", e);
        return { success: false, error: e.message };
    }
};
