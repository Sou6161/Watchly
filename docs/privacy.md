---
title: Watchly — Privacy Policy
---

# Privacy Policy

**Last updated: 19 July 2026**

Watchly helps two people decide what to watch together. This page describes
exactly what the app stores, why, and how to get rid of it. It is written from the
actual database schema rather than from a template, so it should match reality. If
you spot a discrepancy, that's a bug — email **sourabh61saini@gmail.com**.

## What we store

**When you create an account**

| Data | Why |
| --- | --- |
| Email address | To sign you in, and to identify your account |
| Password | Stored only as a **bcrypt hash**. We never store, log, or transmit your actual password, and we cannot recover it |
| Display name | Shown to the person you're swiping with |

**When you set up the app**

| Data | Why |
| --- | --- |
| Region (India / US) | To show titles that actually stream where you are |
| Streaming services you subscribe to | To only show titles you can really watch |

**When you use it**

| Data | Why |
| --- | --- |
| Sessions you take part in | So you can revisit past matches |
| Your swipes (yes / no / seen it / maybe) | To work out what you both agreed on, and to avoid showing you the same title twice within 30 days |
| A saved partner, if you choose to save one | The "start with…" shortcut on your home screen |

**Analytics (PostHog)**

We record five events to understand whether the app works: a session starting,
each swipe (its position in the deck and the decision), the results screen
appearing, a streaming service being opened, and a trailer being played.

These are linked to your **account ID** — never your email — plus your region and
*how many* services you've selected.

**We do not send titles you swiped on, your matches, your email, your name, your
location, your contacts, or any device or advertising identifier.** The analytics
can tell us that someone stopped swiping at card six. It cannot tell us what they
were looking at.

## What we never collect

- Location
- Contacts, photos, files, or microphone
- Advertising identifiers, or anything used to track you across other apps
- Payment details (Watchly is free and has no payments)

## Who else sees your data

- **Neon** hosts the database, and **Render** runs the server. They process data on
  our behalf and don't use it for anything else.
- **PostHog** receives the analytics events described above.
- **TMDB** provides film and series information. We fetch data *from* them; we do
  not send them anything about you.
- **YouTube** serves trailers when you tap to play one. Tapping a trailer loads it
  from YouTube, and YouTube's own privacy policy applies to that playback.

We do not sell your data. We do not share it for advertising.

## How long we keep it

Until you delete your account. Then it goes, as described below.

## Deleting your account

**In the app:** Profile → *Delete my account*. It asks for your password, and it
is immediate and irreversible.

**Without the app:** see [Delete your Watchly account](./delete-account.md), or
email **sourabh61saini@gmail.com** from your registered address and we'll do it
within 30 days.

**What deletion removes:** your account, your sessions, and every swipe in them.

**What deliberately survives:** if you played on separate phones with someone else,
that session belongs to their history too. It isn't deleted from their account —
but your link to it is severed, and only the display name you were using remains
as plain text so their history still reads properly.

## Your rights

You can access, correct, or delete your data at any time — most of it directly in
the app, the rest by emailing us. If you're in the EU or UK, GDPR gives you these
rights explicitly; if you're in India, the DPDP Act does. We honour them
regardless of where you are.

## Children

Watchly isn't directed at children under 13, and we don't knowingly collect their
data.

## Changes

If this policy changes materially, we'll update the date at the top and note the
change in the app.

## Contact

**sourabh61saini@gmail.com**
