import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import { setupWebSockets } from './sockets.js';
import { loadMemory } from './services/memoryService.js';
import { checkAndSendReminders, checkSpecificReminders } from './services/emailService.js';
import { checkProactiveNeeds, runWeeklySelfEvaluation } from './services/proactiveService.js';
import { runMonthlyCleanup } from './services/cleanupService.js';
import { checkPendingCommands } from './services/commandService.js';
import { processSleepCycle } from './services/sleepService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow frontend to connect
    methods: ['GET', 'POST']
  }
});

// Expose io to routes
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load memory on startup
await loadMemory();

// Heartbeat for Proactive J every 15 minutes
// Instead of fixed times, J wakes up every 15 mins and DECIDES if she should talk.
cron.schedule('*/15 * * * *', () => {
  console.log('[J Heartbeat] Checking if J wants to say something or think...');
  checkProactiveNeeds(io);
});

// Check for specific time-based user reminders every minute (CRITICAL for reminders)
cron.schedule('* * * * *', () => {
  checkSpecificReminders(io);
});

// Poll for commands from the J Notification Center (Phone) every 10 seconds
setInterval(() => {
  checkPendingCommands(io);
}, 10000);

// True Memory Synthesis (Idea Graph generation) at 3 AM every day
cron.schedule('0 3 * * *', () => {
  processSleepCycle();
});

// Monthly Cleanup on the 1st of every month at 3 AM
cron.schedule('0 3 1 * *', () => {
  runMonthlyCleanup();
});

// Weekly Personality Upgrade (Every Sunday at 4 AM)
cron.schedule('0 4 * * 0', () => {
  console.log('[J Heartbeat] Running weekly meta-learning personality upgrade...');
  runWeeklySelfEvaluation();
});

// Routes
app.use('/api', apiRoutes);

// Serve frontend build in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Setup WebSockets
setupWebSockets(io);

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`AI Secretary Backend running on http://localhost:${PORT}`);
});