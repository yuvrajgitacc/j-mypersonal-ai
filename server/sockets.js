import { generateAIResponse } from './services/aiService.js';
import { appendToHistory } from './services/memoryService.js';
import { generateInitialGreeting } from './services/proactiveService.js';

export const setupWebSockets = (io) => {
    io.on('connection', async (socket) => {
        console.log('Client connected to AI Secretary:', socket.id);

        // Send an initial varied greeting if appropriate
        const greeting = await generateInitialGreeting();
        if (greeting) {
            socket.emit('proactive_message', { content: greeting });
            await appendToHistory('assistant', greeting);
        }

        socket.on('chat_message', async (data) => {
            const { message } = data;
            console.log(`[Socket] Received message: "${message}"`);
            
            try {
                // J is thinking...
                let aiFullResponse = "";
                
                // Call J's Brain
                const finalResponse = await generateAIResponse(message, (chunk) => {
                    aiFullResponse += chunk;
                    socket.emit('chat_stream', { chunk });
                }, (reminder) => {
                    console.log(`[Socket] Reminder detected: ${reminder.event} at ${reminder.time}`);
                    socket.emit('reminder_saved', { event: reminder.event, time: reminder.time });
                });

                // The message history is ALREADY saved inside generateAIResponse now.
                // So we just need to signal the end of the stream.
                socket.emit('chat_stream_end', { fullText: finalResponse });
                console.log(`[Socket] Finished streaming for: "${message}"`);

            } catch (error) {
                console.error("AI Generation Error:", error);
                socket.emit('chat_error', { error: error.message || 'Failed to generate response. Please try again later.' });
            }
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
};