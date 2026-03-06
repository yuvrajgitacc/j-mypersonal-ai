import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. Connection Logic (Turso vs Local) ---
const useTurso = process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN;

let db;
let isCloud = false;

if (useTurso) {
    console.log("Using Turso Cloud SQLite Database...");
    db = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });
    isCloud = true;
} else {
    console.log("Using Local SQLite Database...");
    const dbPath = path.resolve(__dirname, '..', '..', 'data', 'secretary.db');
    fs.ensureDirSync(path.dirname(dbPath));
    db = new Database(dbPath);
    isCloud = false;
}

// Helper to run raw SQL (Universal for local/cloud)
const execSQL = async (sql, params = []) => {
    if (isCloud) {
        return await db.execute({ sql, args: params });
    } else {
        return db.prepare(sql).run(...params);
    }
};

const queryAll = async (sql, params = []) => {
    if (isCloud) {
        const res = await db.execute({ sql, args: params });
        return res.rows;
    } else {
        return db.prepare(sql).all(...params);
    }
};

const queryOne = async (sql, params = []) => {
    if (isCloud) {
        const res = await db.execute({ sql, args: params });
        return res.rows[0];
    } else {
        return db.prepare(sql).get(...params);
    }
};

// --- 2. Database Initialization ---
export const initDB = async () => {
    const schema = [
        `CREATE TABLE IF NOT EXISTS profile (key TEXT PRIMARY KEY, value TEXT)`,
        `CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, text TEXT, timestamp TEXT)`,
        `CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, event TEXT, time TEXT, sent INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS todo (id TEXT PRIMARY KEY, text TEXT, completed INTEGER DEFAULT 0, timestamp TEXT)`,
        `CREATE TABLE IF NOT EXISTS pdf_extractions (id TEXT PRIMARY KEY, filename TEXT, summary TEXT, entities TEXT, action_items TEXT, upload_date TEXT)`,
        `CREATE TABLE IF NOT EXISTS chat_history (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT, timestamp TEXT)`,
        `CREATE TABLE IF NOT EXISTS long_term_facts (id TEXT PRIMARY KEY, fact TEXT, category TEXT, importance INTEGER DEFAULT 1, timestamp TEXT)`,
        `CREATE TABLE IF NOT EXISTS mood_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, score INTEGER, emotion TEXT, timestamp TEXT)`,
        `CREATE TABLE IF NOT EXISTS internal_monologue (id INTEGER PRIMARY KEY AUTOINCREMENT, thought TEXT, type TEXT, status TEXT DEFAULT 'unspoken', timestamp TEXT)`,
        `CREATE TABLE IF NOT EXISTS j_private_journal (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE, content TEXT, mood_tone TEXT, learned_facts TEXT, timestamp TEXT)`,
        `CREATE TABLE IF NOT EXISTS idea_graph (id INTEGER PRIMARY KEY AUTOINCREMENT, concept_a TEXT, concept_b TEXT, relationship TEXT, timestamp TEXT)`
    ];

    for (const sql of schema) {
        if (isCloud) {
            await db.execute(sql);
        } else {
            db.exec(sql);
        }
    }
    console.log("Database initialized successfully.");
};

// Export db for raw usage if needed (careful with cloud vs local)
export { db };

// --- 3. Memory Service Functions (Updated for Async/Await) ---

export const saveIdeaConnection = async (conceptA, conceptB, relationship) => {
    const timestamp = new Date().toISOString();
    await execSQL('INSERT INTO idea_graph (concept_a, concept_b, relationship, timestamp) VALUES (?, ?, ?, ?)', [conceptA, conceptB, relationship, timestamp]);
};

export const getIdeaGraph = async (limit = 20) => {
    return await queryAll('SELECT * FROM idea_graph ORDER BY timestamp DESC LIMIT ?', [limit]);
};


export const loadMemory = async () => {
    await initDB();
    const jsonPath = path.resolve(__dirname, '..', '..', 'data', 'memory.json');
    if (fs.pathExistsSync(jsonPath)) {
        console.log("Local migration not supported for Cloud DB. Use Local DB for migration first.");
    }
    return getMemoryCache();
};

export const saveMemory = async (data) => {
    if (data.profile) {
        for (const [k, v] of Object.entries(data.profile)) {
            await execSQL('INSERT OR REPLACE INTO profile (key, value) VALUES (?, ?)', [k, String(v)]);
        }
    }
    return true;
};

export const getTodayHistory = async () => {
    const today = new Date().toISOString().split('T')[0];
    return await queryAll("SELECT role, content, timestamp FROM chat_history WHERE timestamp LIKE ? ORDER BY id ASC", [`${today}%`]);
};

export const getArchiveDates = async () => {
    const today = new Date().toISOString().split('T')[0];
    const rows = await queryAll("SELECT DISTINCT strftime('%Y-%m-%d', timestamp) as date FROM chat_history WHERE timestamp NOT LIKE ? ORDER BY date DESC LIMIT 30", [`${today}%`]);
    return rows.map(r => r.date);
};

export const getHistoryByDate = async (date) => {
    return await queryAll("SELECT role, content, timestamp FROM chat_history WHERE timestamp LIKE ? ORDER BY id ASC", [`${date}%`]);
};

export const getRelationshipStats = async () => {
    const profile = await queryAll('SELECT * FROM profile');
    const stats = {};
    profile.forEach(row => stats[row.key] = row.value);

    const totalMessages = (await queryOne('SELECT COUNT(*) as count FROM chat_history')).count;
    const totalNotes = (await queryOne('SELECT COUNT(*) as count FROM notes')).count;
    const totalReminders = (await queryOne('SELECT COUNT(*) as count FROM reminders')).count;
    const totalDocs = (await queryOne('SELECT COUNT(*) as count FROM pdf_extractions')).count;

    const startDate = stats.memberSince ? new Date(stats.memberSince) : new Date();
    const daysTogether = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24));

    return {
        daysTogether: daysTogether || 0,
        startDate: stats.memberSince,
        totalMessages,
        totalNotes,
        totalReminders,
        totalDocs
    };
};

export const getMemoryCache = async () => {
    const profileRows = await queryAll('SELECT * FROM profile');
    const profile = {};
    profileRows.forEach(row => profile[row.key] = row.value);

    if (Object.keys(profile).length === 0) {
        profile.name = "Yuvraj";
        profile.email = "n92042142@gmail.com";
        profile.memberSince = "March 2026";
    }

    const notes = await queryAll('SELECT * FROM notes ORDER BY timestamp DESC');
    const reminders = (await queryAll('SELECT * FROM reminders')).map(r => ({ ...r, sent: !!r.sent }));
    const todo = (await queryAll('SELECT * FROM todo')).map(t => ({ ...t, completed: !!t.completed }));

    const pdfExtractions = (await queryAll('SELECT * FROM pdf_extractions')).map(p => ({
        ...p,
        entities: JSON.parse(p.entities || '[]'),
        actionItems: JSON.parse(p.action_items || '[]'),
        uploadDate: p.upload_date
    }));

    const history = await getTodayHistory();

    return { profile, notes, reminders, todo, pdfExtractions, history };
};

export const deleteMemory = async (category, id) => {
    const tableMap = { notes: 'notes', reminders: 'reminders', todo: 'todo', pdfExtractions: 'pdf_extractions' };
    const table = tableMap[category];
    if (table) {
        await execSQL(`DELETE FROM ${table} WHERE id = ?`, [id]);
        return true;
    }
    return false;
};

export const searchMemory = async (query) => {
    const results = [];
    const q = `%${query}%`;

    const noteMatches = await queryAll('SELECT * FROM notes WHERE text LIKE ?', [q]);
    noteMatches.forEach(m => results.push({ category: 'notes', match: m.text }));

    const pdfMatches = await queryAll('SELECT * FROM pdf_extractions WHERE summary LIKE ? OR filename LIKE ?', [q, q]);
    pdfMatches.forEach(m => results.push({ category: 'documents', match: m.filename }));

    return results;
};

export const appendToHistory = async (role, content) => {
    const timestamp = new Date().toISOString();
    await execSQL('INSERT INTO chat_history (role, content, timestamp) VALUES (?, ?, ?)', [role, content, timestamp]);
    // Auto-cleanup: keep only last 100 messages
    await execSQL('DELETE FROM chat_history WHERE id IN (SELECT id FROM chat_history ORDER BY id DESC LIMIT -1 OFFSET 100)');
};

export const saveNote = async (text) => {
    const id = Date.now().toString();
    const timestamp = new Date().toISOString();
    await execSQL('INSERT INTO notes (id, text, timestamp) VALUES (?, ?, ?)', [id, text, timestamp]);
    return id;
};

export const saveReminder = async (event, time) => {
    const id = Date.now().toString();
    await execSQL('INSERT INTO reminders (id, event, time, sent) VALUES (?, ?, ?, 0)', [id, event, time]);
    return id;
};

export const markReminderSent = async (id) => {
    await execSQL('UPDATE reminders SET sent = 1 WHERE id = ?', [id]);
};

export const archiveDocKnowledge = async (docId) => {
    const doc = await queryOne('SELECT * FROM pdf_extractions WHERE id = ?', [docId]);
    if (doc) {
        const id = `fact_${Date.now()}`;
        const timestamp = new Date().toISOString();
        const distilledFact = `Summary of deleted file (${doc.filename}): ${doc.summary}`;
        await execSQL('INSERT INTO long_term_facts (id, fact, category, importance, timestamp) VALUES (?, ?, ?, ?, ?)', [id, distilledFact, 'archived_docs', 2, timestamp]);
        return true;
    }
    return false;
};

export const savePDFRecord = async (record) => {
    await execSQL('INSERT INTO pdf_extractions (id, filename, summary, entities, action_items, upload_date) VALUES (?, ?, ?, ?, ?, ?)', [record.id, record.filename, record.summary, JSON.stringify(record.entities), JSON.stringify(record.actionItems), record.uploadDate]);
};

export const getAssociativeContext = async () => {
    const recentHistory = (await queryAll('SELECT role, content FROM chat_history ORDER BY id DESC LIMIT 30')).reverse();
    const longTermFacts = await queryAll('SELECT fact, category FROM long_term_facts ORDER BY timestamp DESC LIMIT 20');
    const docSummaries = await queryAll('SELECT filename, summary FROM pdf_extractions ORDER BY upload_date DESC LIMIT 10');
    const recentNotes = await queryAll('SELECT text FROM notes ORDER BY timestamp DESC LIMIT 10');

    return { recentHistory, longTermFacts, docSummaries, recentNotes };
};

export const saveLongTermFact = async (fact, category = 'general', importance = 1) => {
    const id = `fact_${Date.now()}`;
    const timestamp = new Date().toISOString();
    await execSQL('INSERT INTO long_term_facts (id, fact, category, importance, timestamp) VALUES (?, ?, ?, ?, ?)', [id, fact, category, importance, timestamp]);
    return id;
};

export const logUserMood = async (score, emotion) => {
    const timestamp = new Date().toISOString();
    await execSQL('INSERT INTO mood_logs (score, emotion, timestamp) VALUES (?, ?, ?)', [score, emotion, timestamp]);
};

export const saveInternalThought = async (thought, type) => {
    const timestamp = new Date().toISOString();
    await execSQL('INSERT INTO internal_monologue (thought, type, timestamp) VALUES (?, ?, ?)', [thought, type, timestamp]);
};

export const getUnspokenThoughts = async (limit = 5) => {
    return await queryAll("SELECT * FROM internal_monologue WHERE status = 'unspoken' ORDER BY timestamp DESC LIMIT ?", [limit]);
};

export const markThoughtAsShared = async (id) => {
    await execSQL("UPDATE internal_monologue SET status = 'shared' WHERE id = ?", [id]);
};

export const saveJournalEntry = async (date, content, moodTone, learnedFacts) => {
    const timestamp = new Date().toISOString();
    await execSQL('INSERT OR REPLACE INTO j_private_journal (date, content, mood_tone, learned_facts, timestamp) VALUES (?, ?, ?, ?, ?)', [date, content, moodTone, JSON.stringify(learnedFacts), timestamp]);
};

export const getRecentJournals = async (limit = 3) => {
    const rows = await queryAll('SELECT * FROM j_private_journal ORDER BY timestamp DESC LIMIT ?', [limit]);
    return rows.map(j => ({ ...j, learnedFacts: JSON.parse(j.learned_facts || '[]') }));
};
