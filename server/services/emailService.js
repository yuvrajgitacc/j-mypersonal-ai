import nodemailer from 'nodemailer';
import { getMemoryCache } from './memoryService.js';
import { scanForUpcomingEvents } from './aiService.js';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * Sends a notification to the J Notification Center (Render)
 */
export const sendNotificationToCenter = async (title, body, category = "general") => {
    const payload = {
        title: title,
        body: body,
        icon: "https://j-notification-center.onrender.com/logo.svg",
        category: category
    };

    console.log("J is hitting Render...");
    
    try {
        const response = await axios.post('https://j-notification-center.onrender.com/api/notifications', payload);
        console.log(`✅ J -> Render Success. Status: ${response.status}`);
    } catch (error) {
        console.error("❌ J -> Render Failed!");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data);
        } else {
            console.error("Error:", error.message);
        }
    }
};

export const sendEmailNotification = async (subject, text, html, category = "general") => {
    // 1. Send to Notification Center first (Doesn't depend on email credentials)
    await sendNotificationToCenter(subject, text, category);

    const memory = await getMemoryCache();
    const targetEmail = memory.profile?.email;

    if (!targetEmail || targetEmail === "user@example.com") {
        return false;
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn("Email credentials not set. skipping.");
        return false;
    }

    try {
        const mailOptions = {
            from: `"J - Your AI Companion" <${process.env.EMAIL_USER}>`,
            to: targetEmail,
            subject: subject,
            text: text,
            html: html
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Email send failed:", error);
        return false;
    }
};

export const checkAndSendReminders = async () => {
    const memory = await getMemoryCache();
    
    // Use AI to scan all memory for upcoming stuff
    const events = await scanForUpcomingEvents(memory);

    if (events && events.length > 0) {
        const subject = "Boss, you have some important stuff coming up! 📅";
        const eventList = events.map(e => `<li><b>${e.event}</b>: ${e.relevance}</li>`).join('');
        
        const html = `
            <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #eee; border-radius: 12px;">
                <h2 style="color: #3b82f6;">Hey ${memory.profile.name}! 🎓</h2>
                <p>I was just checking through your notes and documents, and I found some things you should keep in mind for tomorrow:</p>
                <div style="background: #f9fafb; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <ul style="margin: 0; padding-left: 20px;">
                        ${eventList}
                    </ul>
                </div>
                <p>Don't stress, you've got this! Just wanted to make sure you're prepared.</p>
                <p style="font-weight: bold;">— J (Your AI Companion)</p>
            </div>
        `;
        
        // 1. Send Email
        await sendEmailNotification(subject, "You have upcoming events. Check your email for details!", html, "reminder");

        // 2. NEW: Send Phone Notification for the Briefing
        const briefMsg = `Good morning ${memory.profile.name}! ☀️ I've prepared your daily briefing. You have ${events.length} important items to keep in mind today. Check your email or the app for details! 📋`;
        await sendNotificationToCenter("Daily Briefing from J", briefMsg, "reminder");

        console.log(`Sent proactive reminder email and phone notification to ${memory.profile.email}`);
    } else {
        console.log("No upcoming events found to notify.");
    }
};

/**
 * Sends J's private journal entry via email.
 */
export const sendJournalEmail = async (date, content, mood) => {
    const memory = await getMemoryCache();
    const subject = `J's Secret Journal: ${date} 🌙`;
    
    const html = `
        <div style="font-family: 'Georgia', serif; padding: 30px; color: #2c3e50; max-width: 650px; border: 1px solid #dcdde1; border-radius: 8px; background-color: #fdfdfd; line-height: 1.6;">
            <h2 style="color: #34495e; border-bottom: 2px solid #3498db; padding-bottom: 10px;">[J's Private Journal]</h2>
            <p style="font-style: italic; color: #7f8c8d;"><b>Date:</b> ${date} | <b>Mood:</b> ${mood}</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            <div style="white-space: pre-wrap; font-size: 16px; color: #34495e;">
                ${content}
            </div>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="text-align: center; color: #95a5a6; font-size: 14px;"><i>-- This is a private reflection generated by J --</i></p>
        </div>
    `;

    console.log(`[J Journal] Sending diary via email for ${date}...`);
    return await sendEmailNotification(subject, content, html, "proactive");
};

export const checkSpecificReminders = async (io) => {
    const memory = await getMemoryCache();
    const now = new Date();
    const { markReminderSent } = await import('./memoryService.js');

    if (memory.reminders) {
        for (const reminder of memory.reminders) {
            const reminderTime = new Date(reminder.time);
            if (!reminder.sent && reminderTime <= now) {
                const subject = `Reminder: ${reminder.event} 🔔`;
                const notificationMsg = `Hey Yuvraj! It's time for: ${reminder.event} 🔔. Don't forget!`;

                // 1. Send Phone Notification (CRITICAL for "Proactive" feel)
                await sendNotificationToCenter("J Reminder", notificationMsg, "reminder");

                // 2. Send Email
                const html = `
                    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #eee; border-radius: 12px;">
                        <h2 style="color: #3b82f6;">Hey ${memory.profile.name}!</h2>
                        <p>You asked me to remind you about this:</p>
                        <div style="background: #f9fafb; padding: 20px; border-radius: 10px; margin: 20px 0; font-size: 18px; font-weight: bold; text-align: center;">
                            ${reminder.event}
                        </div>
                        <p>Hope this helps! I'm always here if you need anything else.</p>
                        <p style="font-weight: bold;">— J (Your AI Companion)</p>
                    </div>
                `;
                await sendEmailNotification(subject, `Reminder: ${reminder.event}`, html, "reminder");
                
                // 3. Send WebSocket Notification (Popup in web app)
                if (io) {
                    const message = `🔔 **Reminder**: ${reminder.event}`;
                    io.emit('proactive_message', { content: message });
                    
                    const { appendToHistory } = await import('./memoryService.js');
                    await appendToHistory('assistant', message);
                }

                // 4. Mark as sent in DB
                await markReminderSent(reminder.id);
                console.log(`Triggered specific reminder (Phone + Email): ${reminder.event}`);
            }
        }
    }
};
