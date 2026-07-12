# Store listings — draft copy

Drafts. Edit freely; the voice should sound like you, not like a template.

---

## App name

**Watchly** — *Decide what to watch, together*

(Subtitle is 30 chars on iOS. "Decide what to watch, together" is exactly 30.)

## Short description (Google Play, 80 chars)

> Swipe through trailers together. See what you both said yes to. Press play.

## Full description

> **Movie night shouldn't take 40 minutes.**
>
> You scroll. They scroll. You both say "I don't mind, you pick." Forty minutes
> later you're watching the same show you always watch, or nothing at all.
>
> Watchly fixes the deciding part.
>
> Two people swipe through trailers — on one phone, passing it back and forth, or
> on separate phones at the same time. Neither of you sees what the other picked.
> At the end, Watchly shows you what you **both** said yes to, and one tap opens
> it in Netflix, Prime Video, JioHotstar, or wherever it's actually streaming.
>
> **How it works**
> • Pick your streaming services once
> • Choose a mood — make us laugh, scare us, blow something up
> • Swipe 15 trailers each. Right for yes, left for no.
> • See your matches. Press play.
>
> **Built for India first.** JioHotstar, Sony LIV, ZEE5, Prime Video, Netflix —
> the catalogue knows what you can actually watch tonight, not what's streaming
> somewhere else in the world.
>
> **No spoilers.** Cards show the trailer, the year, the runtime, the genre. Never
> the plot.
>
> **No algorithm telling you what you want.** Just two people and fifteen
> trailers.

## Keywords (iOS, 100 chars)

```
movie,night,couples,watch,together,swipe,trailer,netflix,prime,hotstar,decide,tv,show,match
```

## Screenshots — what to capture

Order matters; the first two are all most people see.

1. **The swipe card**, mid-tilt with the gold YES label showing. This is the
   product. Lead with it.
2. **The results screen** with 2–3 matches and the streaming buttons visible.
   This is the payoff.
3. **The handoff moment** ("Pass the phone to Aditi") — nobody else has this.
4. **Mood selection** — shows there's control without a settings screen.
5. **Two phones side by side** on the multi-device flow.

Shoot on a real device, not a simulator: the trailer has to be playing in the
card or it looks like a static mockup.

## Reddit / Instagram launch note

Do **not** post the same text to every subreddit — it reads as spam and gets you
banned. Write per-community, lead with the problem, not the app.

Suggested angle for r/india and r/BollywoodMovies: the "you pick / no you pick"
deadlock is universally recognised. Open with that, mention you built the thing,
link second.

Check each subreddit's self-promotion rules before posting. Several of these
require you to have comment history in the community first.

---

## Privacy policy — what you actually collect

You need this URL for both stores. The honest list:

- **Email and a bcrypt hash of the password.** Never the password itself.
- **Display name.**
- **Region and streaming services**, so we can filter the catalogue.
- **Vote history** — which titles you swiped and how — so we don't show you the
  same title twice in 30 days, and so past sessions still work.
- **A saved partner**, if you choose to save one.

You do **not** collect location, contacts, or device identifiers. There's no
third-party analytics wired up yet — if you add PostHog (the spec mentions it),
this list has to be updated before you ship, and both stores will ask you to
declare it.
