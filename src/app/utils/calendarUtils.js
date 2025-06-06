import { google } from 'googleapis';
import { parseISO, addMinutes, isBefore } from 'date-fns';
import dotenv from 'dotenv';
import { allowedBookingDays, getSlotsIfAvailable, isSlotBlocked } from '@/app/utils/cache'

dotenv.config();

const timeZone = 'Asia/Kolkata';
// .toLocaleString("en-US", { timeZone: timeZone })

const calendarId = process.env.GOOGLE_CALENDAR_ID;
const auth = global.googleAuthClient;
const calendar = google.calendar({ version: 'v3', auth });

export function isBookingAllowed(requestedDate) {
    if (!requestedDate) {
        return false;
    }

    // Disallow Sundays (0 = Sunday)
    if (requestedDate.getDay() === 0) {
        return false;
    }

    // const today = new Date();
    // today.setHours(0, 0, 0, 0); // normalize to midnight
    // requestedDate.setHours(0, 0, 0, 0); // normalize

    // const maxAllowedDate = new Date(today);
    // maxAllowedDate.setDate(today.getDate() + allowedBookingDays);

    // // Date in the past or beyond allowed range
    // if (requestedDate < today || requestedDate > maxAllowedDate) {
    //     return false;
    // }

    return true;
}

export async function getAvailableSlots(dateStr) {
    try {

        const date = parseISO(dateStr);

        // Disallow Sundays (0 = Sunday)
        if (date.getDay() === 0) {
            return [];
        }

        const startTime = new Date(date.setHours(5, 30, 0, 0));
        const endTime = new Date(date.setHours(11, 30, 0, 0));

        const eventsRes = await calendar.events.list({
            calendarId,
            timeMin: startTime,
            timeMax: endTime,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const busySlots = eventsRes.data.items.map(e => [
            new Date(e.start.dateTime),
            new Date(e.end.dateTime)
        ]);

        const availableSlots = [];
        let current = startTime;
        while (isBefore(current, endTime)) {
            const next = addMinutes(current, 30);
            const overlap = busySlots.some(([start, end]) => current < end && next > start);
            if (!overlap) {
                // Add 5 hours 30 minutes manually
                const istTime = new Date(current.getTime() + 5.5 * 60 * 60 * 1000);
                const timeStr = istTime.toTimeString().slice(0, 5); // 'HH:mm'
                availableSlots.push(timeStr);
            }
            current = next;
        }

        return availableSlots;
    } catch (err) {
        console.error("Failed to get available slots from calendar:", err);
        throw err;
    }
}

export async function bookSlot(dateStr, timeSlot, email, mobile, name, reason) {
    const [hours, minutes] = timeSlot.split(':').map(Number);

    const start = new Date(dateStr);
    start.setHours(hours, minutes || 0, 0, 0);

    const end = new Date(start.getTime() + 30 * 60 * 1000);


    // if slot is blocked, then it is fine
    // else we have to check if it is available explicitly
    if (!await isSlotBlocked(dateStr, timeSlot)) {
        const available = await getSlotsIfAvailable(dateStr);
        if (!available.includes(timeSlot)) {
            return { status: 'failed', reason: 'Slot already booked' };
        }
    }

    const event = {
        summary: process.env.EVENT_SUMMARY || 'Discussion',
        description: `Name: ${name || 'N/A'}\nMobile: ${mobile || 'N/A'}\nEmail: ${email}\n\n\nDetails: ${reason || process.env.EVENT_SUMMARY || 'Discussion'}`,
        start: { dateTime: toLocalISOString(start), timeZone: 'Asia/Kolkata' },
        end: { dateTime: toLocalISOString(end), timeZone: 'Asia/Kolkata' },
        attendees: [
            { email }, // guest will get an email invitation
        ],
        reminders: {
            useDefault: true,
        },
    };

    try {
        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
            sendUpdates: 'all', //  sends email to attendees
        });

        return {
            status: 'success',
            booked: timeSlot,
            eventId: response.data.id,
            summary: response.data.summary,
            start: response.data.start,
            end: response.data.end,
        }
    } catch (err) {
        console.error('Failed to book slot: ', err);
        throw err;
    }
}

function toLocalISOString(date) {
    const pad = (n) => (n < 10 ? '0' + n : n);
    return (
        date.getFullYear() +
        '-' +
        pad(date.getMonth() + 1) +
        '-' +
        pad(date.getDate()) +
        'T' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes()) +
        ':00'
    );
}