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
            
            // Save user message to history
            await appendToHistory('user', message);

            try {
                let aiFullResponse = "";
                
                await generateAIResponse(message, (chunk) => {
                    aiFullResponse += chunk;
                    socket.emit('chat_stream', { chunk });
                }, (reminder) => {
                    // FLAW 3: Emit event to show UI notification
                    socket.emit('reminder_saved', { event: reminder.event, time: reminder.time });
                });

                // End of stream
                socket.emit('chat_stream_end', { fullText: aiFullResponse });
                
                // Save AI response to history
                await appendToHistory('assistant', aiFullResponse);

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