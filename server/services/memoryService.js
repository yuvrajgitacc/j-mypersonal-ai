import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The db should be in a data folder in the project root
const dbPath = path.resolve(__dirname, '..', '..', 'data', 'secretary.db');
const jsonPath = path.resolve(__dirname, '..', '..', 'data', 'memory.json');

// Ensure data directory exists
fs.ensureDirSync(path.dirname(dbPath));

export const db = new Database(dbPath);

// --- 1. Database Initialization (Tables) ---
db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        text TEXT,
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        event TEXT,
        time TEXT,
        sent INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS todo (
        id TEXT PRIMARY KEY,
        text TEXT,
        completed INTEGER DEFAULT 0,
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS pdf_extractions (
        id TEXT PRIMARY KEY,
        filename TEXT,
        summary TEXT,
        entities TEXT,
        action_items TEXT,
        upload_date TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        content TEXT,
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS long_term_facts (
        id TEXT PRIMARY KEY,
        fact TEXT,
        category TEXT,
        importance INTEGER DEFAULT 1,
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS mood_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        score INTEGER,
        emotion TEXT,
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS internal_monologue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thought TEXT,
        type TEXT, -- 'daydream', 'curiosity', 'reflection'
        status TEXT DEFAULT 'unspoken', -- 'unspoken', 'shared'
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS j_private_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE,
        content TEXT,
        mood_tone TEXT, -- 'soft', 'firm', 'inspired', 'worried'
        learned_facts TEXT, -- JSON array of things she learned about you
        timestamp TEXT
    );
`);

// --- 2. Data Migration Logic (JSON to SQLite) ---
export const loadMemory = async () => {
    if (fs.pathExistsSync(jsonPath)) {
        console.log("Migrating existing JSON data to SQLite...");
        try {
            const data = fs.readJsonSync(jsonPath);

            // Migrate Profile
            if (data.profile) {
                const stmt = db.prepare('INSERT OR REPLACE INTO profile (key, value) VALUES (?, ?)');
                Object.entries(data.profile).forEach(([k, v]) => stmt.run(k, String(v)));
            }

            // Migrate Notes
            if (data.notes) {
                const stmt = db.prepare('INSERT OR IGNORE INTO notes (id, text, timestamp) VALUES (?, ?, ?)');
                data.notes.forEach(n => stmt.run(n.id, n.text, n.timestamp));
            }

            // Migrate Reminders
            if (data.reminders) {
                const stmt = db.prepare('INSERT OR IGNORE INTO reminders (id, event, time, sent) VALUES (?, ?, ?, ?)');
                data.reminders.forEach(r => stmt.run(r.id, r.event, r.time, r.sent ? 1 : 0));
            }

            // Migrate PDF Extractions
            if (data.pdfExtractions) {
                const stmt = db.prepare('INSERT OR IGNORE INTO pdf_extractions (id, filename, summary, entities, action_items, upload_date) VALUES (?, ?, ?, ?, ?, ?)');
                data.pdfExtractions.forEach(p => stmt.run(p.id, p.filename, p.summary, JSON.stringify(p.entities), JSON.stringify(p.actionItems), p.uploadDate));
            }

            // Migrate History
            if (data.history) {
                const stmt = db.prepare('INSERT INTO chat_history (role, content, timestamp) VALUES (?, ?, ?)');
                data.history.forEach(h => stmt.run(h.role, h.content, h.timestamp));
            }

            // Backup and delete old JSON
            fs.renameSync(jsonPath, jsonPath + '.bak');
            console.log("Migration complete. Old data backed up as memory.json.bak");
        } catch (err) {
            console.error("Migration failed:", err);
        }
    }
    return getMemoryCache();
};

// --- 3. Memory Service Functions ---

export const saveMemory = async (data) => {
    // This is a legacy function for bulk updates if needed
    // In SQLite, we usually update specific tables.
    if (data.profile) {
        const stmt = db.prepare('INSERT OR REPLACE INTO profile (key, value) VALUES (?, ?)');
        Object.entries(data.profile).forEach(([k, v]) => stmt.run(k, String(v)));
    }
    return true;
};

export const getTodayHistory = () => {
    const today = new Date().toISOString().split('T')[0];
    return db.prepare("SELECT role, content, timestamp FROM chat_history WHERE timestamp LIKE ? ORDER BY id ASC")
        .all(`${today}%`);
};

export const getArchiveDates = () => {
    // Get unique dates from chat history (excluding today)
    const today = new Date().toISOString().split('T')[0];
    const rows = db.prepare("SELECT DISTINCT strftime('%Y-%m-%d', timestamp) as date FROM chat_history WHERE timestamp NOT LIKE ? ORDER BY date DESC LIMIT 30")
        .all(`${today}%`);
    return rows.map(r => r.date);
};

export const getHistoryByDate = (date) => {
    return db.prepare("SELECT role, content, timestamp FROM chat_history WHERE timestamp LIKE ? ORDER BY id ASC")
        .all(`${date}%`);
};

export const getRelationshipStats = () => {
    const profile = db.prepare('SELECT * FROM profile').all();
    const stats = {};
    profile.forEach(row => stats[row.key] = row.value);

    // Get counts
    const totalMessages = db.prepare('SELECT COUNT(*) as count FROM chat_history').get().count;
    const totalNotes = db.prepare('SELECT COUNT(*) as count FROM notes').get().count;
    const totalReminders = db.prepare('SELECT COUNT(*) as count FROM reminders').get().count;
    const totalDocs = db.prepare('SELECT COUNT(*) as count FROM pdf_extractions').get().count;

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

export const getMemoryCache = () => {
    const profileRows = db.prepare('SELECT * FROM profile').all();
    const profile = {};
    profileRows.forEach(row => profile[row.key] = row.value);

    // If profile is empty, set defaults
    if (Object.keys(profile).length === 0) {
        profile.name = "Yuvraj";
        profile.email = "n92042142@gmail.com";
        profile.memberSince = "March 2026";
    }

    const notes = db.prepare('SELECT * FROM notes ORDER BY timestamp DESC').all();
    const reminders = db.prepare('SELECT * FROM reminders').all().map(r => ({ ...r, sent: !!r.sent }));
    const todo = db.prepare('SELECT * FROM todo').all().map(t => ({ ...t, completed: !!t.completed }));

    const pdfExtractions = db.prepare('SELECT * FROM pdf_extractions').all().map(p => ({
        ...p,
        entities: JSON.parse(p.entities || '[]'),
        actionItems: JSON.parse(p.action_items || '[]'),
        uploadDate: p.upload_date
    }));

    // DEFAULT: Only return today's history for the main chat view
    const history = getTodayHistory();

    return {
        profile,
        notes,
        reminders,
        todo,
        pdfExtractions,
        history
    };
};

export const deleteMemory = async (category, id) => {
    const tableMap = {
        notes: 'notes',
        reminders: 'reminders',
        todo: 'todo',
        pdfExtractions: 'pdf_extractions'
    };

    const table = tableMap[category];
    if (table) {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        return true;
    }
    return false;
};

export const searchMemory = (query) => {
    const results = [];
    const q = `%${query}%`;

    const noteMatches = db.prepare('SELECT * FROM notes WHERE text LIKE ?').all(q);
    noteMatches.forEach(m => results.push({ category: 'notes', match: m.text }));

    const pdfMatches = db.prepare('SELECT * FROM pdf_extractions WHERE summary LIKE ? OR filename LIKE ?').all(q, q);
    pdfMatches.forEach(m => results.push({ category: 'documents', match: m.filename }));

    return results;
};

export const appendToHistory = async (role, content) => {
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO chat_history (role, content, timestamp) VALUES (?, ?, ?)')
        .run(role, content, timestamp);

    // Auto-cleanup: keep only last 100 messages
    db.prepare('DELETE FROM chat_history WHERE id IN (SELECT id FROM chat_history ORDER BY id DESC LIMIT -1 OFFSET 100)').run();
};

// Helper for specific saving (like from AI service)
export const saveNote = (text) => {
    const id = Date.now().toString();
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO notes (id, text, timestamp) VALUES (?, ?, ?)').run(id, text, timestamp);
    return id;
};

export const saveReminder = (event, time) => {
    const id = Date.now().toString();
    db.prepare('INSERT INTO reminders (id, event, time, sent) VALUES (?, ?, ?, 0)').run(id, event, time);
    return id;
};

export const markReminderSent = (id) => {
    db.prepare('UPDATE reminders SET sent = 1 WHERE id = ?').run(id);
};

export const archiveDocKnowledge = (docId) => {
    const doc = db.prepare('SELECT * FROM pdf_extractions WHERE id = ?').get(docId);
    if (doc) {
        const id = `fact_${Date.now()}`;
        const timestamp = new Date().toISOString();
        const distilledFact = `Summary of deleted file (${doc.filename}): ${doc.summary}`;
        db.prepare('INSERT INTO long_term_facts (id, fact, category, importance, timestamp) VALUES (?, ?, ?, ?, ?)')
            .run(id, distilledFact, 'archived_docs', 2, timestamp);
        return true;
    }
    return false;
};

export const savePDFRecord = (record) => {
    db.prepare('INSERT INTO pdf_extractions (id, filename, summary, entities, action_items, upload_date) VALUES (?, ?, ?, ?, ?, ?)')
        .run(record.id, record.filename, record.summary, JSON.stringify(record.entities), JSON.stringify(record.actionItems), record.uploadDate);
};

export const getAssociativeContext = () => {
    // Get last 30 chat messages (more than the usual 10)
    const recentHistory = db.prepare('SELECT role, content FROM chat_history ORDER BY id DESC LIMIT 30').all().reverse();

    // Get all long-term facts
    const longTermFacts = db.prepare('SELECT fact, category FROM long_term_facts ORDER BY timestamp DESC LIMIT 20').all();

    // Get a summary of documents
    const docSummaries = db.prepare('SELECT filename, summary FROM pdf_extractions ORDER BY upload_date DESC LIMIT 10').all();

    // Get a few recent notes
    const recentNotes = db.prepare('SELECT text FROM notes ORDER BY timestamp DESC LIMIT 10').all();

    return {
        recentHistory,
        longTermFacts,
        docSummaries,
        recentNotes
    };
};

export const saveLongTermFact = (fact, category = 'general', importance = 1) => {
    const id = `fact_${Date.now()}`;
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO long_term_facts (id, fact, category, importance, timestamp) VALUES (?, ?, ?, ?, ?)')
        .run(id, fact, category, importance, timestamp);
    return id;
};

export const logUserMood = (score, emotion) => {
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO mood_logs (score, emotion, timestamp) VALUES (?, ?, ?)').run(score, emotion, timestamp);
};

export const saveInternalThought = (thought, type) => {
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO internal_monologue (thought, type, timestamp) VALUES (?, ?, ?)').run(thought, type, timestamp);
};

export const getUnspokenThoughts = (limit = 5) => {
    return db.prepare("SELECT * FROM internal_monologue WHERE status = 'unspoken' ORDER BY timestamp DESC LIMIT ?").all(limit);
};

export const markThoughtAsShared = (id) => {
    db.prepare("UPDATE internal_monologue SET status = 'shared' WHERE id = ?").run(id);
};

export const saveJournalEntry = (date, content, moodTone, learnedFacts) => {
    const timestamp = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO j_private_journal (date, content, mood_tone, learned_facts, timestamp) VALUES (?, ?, ?, ?, ?)')
        .run(date, content, moodTone, JSON.stringify(learnedFacts), timestamp);
};

export const getRecentJournals = (limit = 3) => {
    return db.prepare('SELECT * FROM j_private_journal ORDER BY timestamp DESC LIMIT ?').all(limit).map(j => ({
        ...j,
        learnedFacts: JSON.parse(j.learned_facts || '[]')
    }));
};
