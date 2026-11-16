# My Fitness Log (FitLog)

A simple workout tracker that works like an app on your iPhone home screen. It's free, it works offline and it doesn't need the App Store.

**Version 1 tracks:** strength workouts (sets × kg × reps), cardio (time + km + pace) and swimming (laps × pool length).

## Files

| File | What it does |
|---|---|
| `index.html` | The page and bottom tab bar |
| `styles.css` | All the design (dark theme, lime accent) |
| `app.js` | All the logic: workouts, history, progress, programs |
| `auth.js` | Email + password accounts and cloud sync (Supabase) |
| `config.js` | Your Supabase project URL + key |
| `supabase.sql` | Database table + security rules (run once in Supabase) |
| `manifest.json` | Makes it installable (name, icon, colors) |
| `sw.js` | Service worker, makes it open offline at the gym |
| `icons/` | App icons |

Data is saved on the phone first (works offline) and synced to your account in the cloud. **Set up accounts: see `SETUP-ACCOUNTS.md`.**

## Run it on your Mac

1. Open this folder in VS Code.
2. Install the **Live Server** extension (by Ritwick Dey).
3. Right-click `index.html` → **Open with Live Server**.
4. In Chrome press `Cmd + Option + I`, then click the phone icon to see it at phone size.

Or in Terminal: `python3 -m http.server 8000` and open http://localhost:8000

## Put it on your iPhone (free)

1. Create a free account on github.com and make a new **public** repository, e.g. `fitness-tracker`.
2. Upload all the files in this folder (or use VS Code's Source Control → Publish to GitHub).
3. In the repo: **Settings → Pages → Branch: main → Save**.
4. After about a minute your app is live at `https://<your-username>.github.io/fitness-tracker/`
5. On the iPhone open that link in **Safari** → tap **Share** → **Add to Home Screen**.

Each time you push changes, the app updates on its own the next time you open it with internet.

## Plan

- [x] **Step 1:** PWA with data on the phone, offline (this version)
- [x] **Step 2:** accounts + cloud sync (e.g. Supabase free tier) so data isn't lost when you change phones
- [ ] **Step 3:** subscription. Logging stays free and unlimited; extras (full graph history, more ready-made programs, export) are paid
