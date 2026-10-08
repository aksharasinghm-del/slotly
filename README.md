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

Requires Node.js 22.

```bash
npm install
node --env-file=.env server.js    # or just `npm start` for demo mode
```

Open http://localhost:3000. If no Google credentials are set, the app runs in **demo mode**: you can click through everything, but nothing syncs to Google. Data is kept in `data/slotly.db` unless `TURSO_DATABASE_URL` is set.

## Put it online for free

Everything below is free and needs no credit card:

| What | Service | Free plan |
|---|---|---|
| Website | [Vercel](https://vercel.com) (Hobby) | Sign in with GitHub |
| Database | [Turso](https://turso.tech) | 5 GB storage, 100 databases |
| Calendar + Gmail | Google Cloud | Free for personal use |

### Step 1: Database (Turso, about 3 minutes)
1. Go to https://app.turso.tech and sign up with GitHub.
2. Click **Create Database**, name it `slotly`, and pick the region closest to you.
3. On the database page, copy the **URL** (starts with `libsql://`).
4. Click **Create Token** and copy it.

### Step 2: Website (Vercel, about 3 minutes)
1. Go to https://vercel.com/new and sign in with GitHub (choose the free **Hobby** plan).
2. Import the `slotly` repository. Vercel detects the Express app automatically, so don't change any build settings.
3. Open **Environment Variables** and add:
   - `TURSO_DATABASE_URL`: the URL from step 1
   - `TURSO_AUTH_TOKEN`: the token from step 1
4. Click **Deploy**. Your site is live at `https://slotly-xxxx.vercel.app` (it runs in demo mode until step 3).

### Step 3: Connect Google (about 10 minutes, one time)
1. Go to https://console.cloud.google.com and create a project called `Slotly`.
2. **APIs & Services → Library**: enable **Google Calendar API** and **Gmail API**.
3. **Google Auth Platform → Branding**: app name `Slotly`, your email as the support and developer contact.
4. **Audience**: choose **External**, then click **Publish app** so the status says **In production**.
   *This matters: in "Testing" mode Google disconnects your calendar every 7 days.* You don't need Google's verification for your own use. When you sign in, Google shows "Google hasn't verified this app". Click **Advanced → Go to Slotly** to continue.
5. **Data Access → Add or remove scopes**: add `.../auth/calendar.events`, `.../auth/calendar.freebusy`, `.../auth/calendar.calendarlist.readonly` and `.../auth/gmail.send`.
6. **Clients → Create client → Web application**. Under **Authorized redirect URIs** add
   `https://YOUR-SITE.vercel.app/auth/google/callback` (use your real Vercel address).
7. Copy the **Client ID** and **Client secret** into Vercel → your project → **Settings → Environment Variables** as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Also add `ALLOWED_EMAILS` = your Gmail address, so only you can sign in as the host.
8. In Vercel go to **Deployments → ⋯ → Redeploy**. Then open your site and click **Sign up with Google**.

### Notes on the free plans
- Vercel's Hobby plan is meant for personal, non-commercial projects. If you use Slotly for a business, the free alternative is **Render**, which allows commercial use: sign in at https://render.com, click **New → Blueprint**, pick this repo (it includes `render.yaml`), and paste the same values. Free Render apps sleep when idle, so the first visit after a quiet period takes about a minute to load.
- Both options keep your data in Turso, so redeploys and restarts never lose bookings.

## Project layout

```
server.js            Express server: auth, REST API, page routes
lib/google.js        Google OAuth + Calendar API (freeBusy, events insert/patch/delete)
lib/slots.js         Availability → bookable slot calculation
lib/time.js          Time-zone math (Intl based, no dependencies)
lib/suggest.js       Smart time suggestions for invite links
lib/email.js         Invite email (HTML + text) sent through Gmail
lib/ics.js           .ics calendar file generation
lib/db.js            Database (local SQLite file or Turso)
lib/pages.js         HTML pages bundled from views/ (npm run build:pages)
views/               HTML page templates
public/              Landing page, dashboard (app.js), booking/profile/manage pages
test/                Unit tests: npm test
```

## Notes and limits

- Google refresh tokens are stored in your database. Keep the Turso token private.
- Bookings are one-on-one. Group or round-robin events, paid bookings, and SMS reminders are not included.
- Events deleted directly in Google Calendar are not synced back into the Meetings list. Cancel from the app to keep both in sync.
