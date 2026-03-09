import nodemailer from 'nodemailer';
import { getMemoryCache } from './memoryService.js';
import { scanForUpcomingEvents } from './aiService.js';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // Use SSL
    pool: true,   // Use connection pooling
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

/**
 * Sends a direct email without hitting the phone notification center.
 * Used for private journals.
 */
export const sendDirectEmail = async (subject, text, html) => {
    const memory = await getMemoryCache();
    const targetEmail = memory.profile?.email;

    if (!targetEmail || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false;

    try {
        const mailOptions = {
            from: `"J - Private Journal" <${process.env.EMAIL_USER}>`,
            to: targetEmail,
            subject: subject,
            text: text,
            html: html
        };
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("Direct email failed:", error);
        return false;
    }
};

export const sendEmailNotification = async (subject, text, html, category = "general") => {
    // ONLY send to Notification Center if it's NOT a proactive/journal category
    if (category !== "proactive" && category !== "journal") {
        await sendNotificationToCenter(subject, text, category);
    }

    const memory = await getMemoryCache();
    const targetEmail = memory.profile?.email;

    if (!targetEmail || targetEmail === "user@example.com") return false;
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false;

    try {
        const mailOptions = {
            from: `"J - Assistant" <${process.env.EMAIL_USER}>`,
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
    // DISABLED: No more annoying unrequested briefings.
    console.log("[J Briefing] Proactive briefings are currently disabled to prevent spam.");
    return;
};

/**
 * Sends J's private journal entry via email.
 */
export const sendJournalEmail = async (date, content, mood) => {
    const subject = `J's Secret Journal: ${date} 🌙`;
    const html = `
        <div style="font-family: 'Georgia', serif; padding: 30px; color: #2c3e50; max-width: 650px; border: 1px solid #dcdde1; border-radius: 8px; background-color: #fdfdfd; line-height: 1.6;">
            <h2 style="color: #34495e; border-bottom: 2px solid #3498db; padding-bottom: 10px;">[J's Private Journal]</h2>
            <p style="font-style: italic; color: #7f8c8d;"><b>Date:</b> ${date} | <b>Mood:</b> ${mood}</p>
            <div style="white-space: pre-wrap; font-size: 16px; color: #34495e;">${content}</div>
        </div>
    `;
    console.log(`[J Journal] Mailing private journal for ${date}...`);
    return await sendDirectEmail(subject, content, html);
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
                const notificationMsg = `Hey ${memory.profile.name}! It's time for: ${reminder.event} 🔔. Don't forget!`;

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
