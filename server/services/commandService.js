import axios from 'axios';
import { generateAIResponse } from './aiService.js';
import { appendToHistory } from './memoryService.js';
import { sendNotificationToCenter } from './emailService.js';

/**
 * Polls the Notification Center for pending commands
 */
export const checkPendingCommands = async (io) => {
    try {
        const response = await axios.get('https://j-notification-center.onrender.com/api/commands/pending');
        const commands = response.data.commands || [];

        for (const command of commands) {
            console.log(`Processing command from phone: ${command.text}`);
            
            // 1. Log user command in history
            await appendToHistory('user', `[Phone Command]: ${command.text}`);

            // 2. Generate AI Response
            let fullAiResponse = "";
            await generateAIResponse(command.text, (chunk) => {
                fullAiResponse += chunk;
                // Emit to UI so user sees it if they open the web app
                io.emit('chat_stream', { chunk });
            }, (reminder) => {
                io.emit('reminder_saved', { event: reminder.event, time: reminder.time });
            });

            // 3. End stream and save history
            io.emit('chat_stream_end', { fullText: fullAiResponse });
            await appendToHistory('assistant', fullAiResponse);

            // 4. Send the response BACK to the phone
            await sendNotificationToCenter("J's Reply", fullAiResponse, "chat");

            // 5. Mark command as processed in the Notification Center
            try {
                await axios.post(`https://j-notification-center.onrender.com/api/commands/processed/${command.id}`);
            } catch (err) {
                console.error(`Failed to mark command ${command.id} as processed:`, err.message);
            }
        }
    } catch (error) {
        // Quietly fail polling
        if (error.code !== 'ECONNREFUSED') {
            // console.error("Command Polling Error:", error.message);
        }
    }
};
