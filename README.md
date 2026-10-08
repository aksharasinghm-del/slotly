# Slotly — Calendly-style scheduling with Google Calendar

Share a booking link, let people pick a free time, and every booking lands on your Google Calendar with a Google Meet link and email invites sent to every guest.

## Features

**For you (the host)**
- Sign in with Google. Your account connects to Google Calendar at the same time.
- **Event types**, e.g. "30 Minute Meeting": duration, location (Google Meet, phone, in person, custom), description, color, custom URL, on/off toggle, duplicate, delete
- **Scheduling limits**: minimum notice, how many days ahead people can book, buffers before and after, and start-time increments
- **Availability**: weekly hours with several intervals per day, "copy to all days", and your time zone
- **Conflict checking**: busy times on the Google calendars you pick are hidden from your booking pages, live
- **Meetings**: upcoming, past and canceled bookings with invitee details, notes, guests and Meet link. You can cancel a meeting, and Google emails the cancellation.
- **Sharing**: copy your link, email/WhatsApp/LinkedIn share, "add times to email" (pick slots and paste them as one-click booking links), and an embed code for your website

**Send specific times (invite links)**
- Choose **any dates and times**, including times outside your usual working hours. You can tap times on a calendar or type in a custom time.
- **Smart suggestions**: "Let Slotly pick for me" finds free times on your Google Calendar. It spreads them over different days, prefers the part of the day you choose (mornings, afternoons or evenings), and avoids back-to-back meetings.
- **Conflict warnings**: any time that clashes with your calendar is flagged before you send it.
- Add the customer's name, email and a personal message, then **send it from your own Gmail** in one click. The email has clickable time buttons that book instantly. You can also open it in your email app, share it on WhatsApp or copy the message.
- The customer only sees the times you picked, in their own time zone, with their name and email already filled in.
- The link closes after one booking (you can turn this off). You can see each link's status (Open, Booked or Expired) and turn a link off at any time.

**For invitees**
- Public profile page (`/your-name`) listing your event types
- Booking page with a month calendar and time slots shown in their own time zone (auto-detected, can be changed), plus an am/pm or 24h toggle
- Details form with name, email, up to 10 extra guests, notes, and a phone number for phone calls
- Confirmation page with "Add to Google / Outlook / iCal" buttons
- Self-service **reschedule** and **cancel** links. These are also in the calendar invite.

**What happens on Google Calendar when someone books**
1. The app creates an event on your primary calendar with the invitee and their guests as attendees (`sendUpdates=all`), so **Google emails the invites**.
2. A unique **Google Meet** link is attached for Meet event types.
3. A reschedule moves the event and Google emails the update. A cancellation deletes it and Google emails the cancellation.

## Run locally

Requires **Node.js 22.13+**. The app uses the built-in `node:sqlite`, so there is no database to install.

```bash
npm install
cp .env.example .env    # then fill it in (see below)
node --env-file=.env --disable-warning=ExperimentalWarning server.js
```

Open http://localhost:3000. If no Google credentials are set, the app runs in **demo mode**: you can click through everything, but nothing syncs to Google.

## Connect Google Calendar (one-time setup, about 10 minutes)

1. Go to https://console.cloud.google.com/ and create a project.
2. **APIs & Services → Library**: enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, fill in the app name and your email.
   - Scopes: `openid`, `email`, `profile`, `.../auth/calendar.events`, `.../auth/calendar.readonly`, `.../auth/gmail.send` (lets the app send invite emails from your Gmail).
   - Also enable the **Gmail API** under APIs & Services → Library.
   - Under **Test users**, add your own Gmail address. While the app is in "Testing", only test users can sign in, which is fine when you are the only host.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/auth/google/callback`, and later also `https://YOUR-DOMAIN/auth/google/callback`
5. Copy the Client ID and Client secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `SESSION_SECRET` to a long random string.
6. Restart the server and click **Sign up with Google**.

> Invitees never sign in. Only you (the host) connect Google. Invitees just get the email invite.

## Deploy (put it on the internet)

This repo includes a `render.yaml`, so Render sets everything up for you.

1. Create a free account at https://render.com and sign in with GitHub.
2. Open **https://render.com/deploy?repo=https://github.com/OWNER/REPO**, replacing it with this repo's URL, or in Render click **New → Blueprint** and pick this repo.
3. Render asks for three values. You can leave all of them empty for now:
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: from the Google setup above. Empty means demo mode.
   - `ALLOWED_EMAILS`: your Gmail address, so only you can sign in as a host.
4. Click **Apply**. After a few minutes your site is live at `https://slotly-xxxx.onrender.com`.
5. Back in Google Cloud, add `https://slotly-xxxx.onrender.com/auth/google/callback` as an authorized redirect URI. Then paste the Client ID and Secret into Render → your service → **Environment**. Render restarts the app automatically.

Cost: Render's **Starter** plan (about $7/month) plus a 1 GB disk (about $0.25/month). The disk is what keeps your bookings and settings safe across restarts. Render's free plan wipes data on every restart, so it isn't used.

Other hosts: any server with Node 22 and a persistent folder works. There's a `Dockerfile` for Railway or Fly.io; mount a volume and set `DATABASE_PATH` to a file inside it.

## Project layout

```
server.js            Express server: auth, REST API, page routes
lib/google.js        Google OAuth + Calendar API (freeBusy, events insert/patch/delete)
lib/slots.js         Availability → bookable slot calculation
lib/time.js          Time-zone math (Intl based, no dependencies)
lib/suggest.js       Smart time suggestions for invite links
lib/email.js         Invite email (HTML + text) sent through Gmail
lib/ics.js           .ics calendar file generation
lib/db.js            SQLite schema
public/              Landing page, dashboard (app.js), booking/profile/manage pages
test/                Unit tests: npm test
```

## Notes and limits

- Google refresh tokens are stored in the SQLite database. Keep the database file private and back it up.
- Bookings are one-on-one. Group or round-robin events, paid bookings, and SMS reminders are not included.
- Events deleted directly in Google Calendar are not synced back into the Meetings list. Cancel from the app to keep both in sync.
