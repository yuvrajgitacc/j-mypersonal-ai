import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { processPDF } from '../services/pdfService.js';
import { getMemoryCache, saveMemory, deleteMemory, searchMemory, saveLongTermFact, saveNote, appendToHistory } from '../services/memoryService.js';
import { sendEmailNotification } from '../services/emailService.js';
import { checkProactiveNeeds } from '../services/proactiveService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.resolve(__dirname, '..', 'uploads');
fs.ensureDirSync(uploadsDir);

const upload = multer({ dest: uploadsDir });

// --- Profile Endpoints ---
router.get('/profile', (req, res) => {
    const memory = getMemoryCache();
    // Return the profile from memory or a default if not set
    res.json(memory.profile || { name: "User", email: "user@example.com", memberSince: "March 2026" });
});

router.post('/profile', async (req, res) => {
    try {
        const memory = getMemoryCache();
        memory.profile = { ...memory.profile, ...req.body };
        const success = await saveMemory(memory);
        res.json({ success, profile: memory.profile });
    } catch (error) {
        console.error("Profile Update Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Memory Endpoints ---
router.get('/memory', (req, res) => {
    res.json(getMemoryCache());
});

router.get('/docs', (req, res) => {
    const memory = getMemoryCache();
    res.json(memory.pdfExtractions || []);
});

router.delete('/docs/:id', async (req, res) => {
    const { id } = req.params;
    const { archive } = req.query;
    
    if (archive === 'true') {
        const { archiveDocKnowledge } = await import('../services/memoryService.js');
        archiveDocKnowledge(id);
    }
    
    const success = await deleteMemory('pdfExtractions', id);
    res.json({ success });
});

router.post('/memory', async (req, res) => {
    const success = await saveMemory(req.body);
    res.json({ success });
});

router.delete('/memory/:category/:id', async (req, res) => {
    const { category, id } = req.params;
    const success = await deleteMemory(category, id);
    res.json({ success });
});

router.get('/memory/search', (req, res) => {
    const { q } = req.query;
    res.json(searchMemory(q || ''));
});

// --- Archive Endpoints ---
router.get('/memory/archive/dates', async (req, res) => {
    const { getArchiveDates } = await import('../services/memoryService.js');
    res.json(getArchiveDates());
});

router.get('/memory/archive/:date', async (req, res) => {
    const { date } = req.params;
    const { getHistoryByDate } = await import('../services/memoryService.js');
    res.json(getHistoryByDate(date));
});

// --- PDF Handling Endpoint ---
router.post('/upload-pdf', upload.single('document'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No PDF uploaded' });
    }
    try {
        const result = await processPDF(req.file.path, req.file.originalname);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process PDF' });
    }
});

// --- Voice Endpoints ---
router.post('/stt', upload.single('audio'), async (req, res) => {
    res.json({ text: "This is a transcribed text stub from STT." });
});

router.post('/tts', async (req, res) => {
    const { text } = req.body;
    res.json({ audioUrl: "/stub-audio-url.mp3", text });
});

export default router;