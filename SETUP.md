# PROFCON 2026 Receipts — setup (about 10 minutes)

Frontend: Cloudflare Pages (static files from this GitHub repo). Backend: Google Sheet + Apps Script.

## 1. Sheet and script
1. Go to https://sheets.new and name it **PROFCON 2026 Receipts**.
2. **Extensions → Apps Script**, delete the sample code, paste all of `apps-script/Code.gs`, save.
3. Pick the function **setup** in the toolbar and click **Run**; approve the permissions (Advanced → Go to project → Allow).
   This creates the tabs Districts, Receipts, Expenses, Settings, adds the 14 Kerala districts and sets the admin key to `1234`.

## 2. Publish as a web app
**Deploy → New deployment → Web app** · Execute as **Me** · Who has access **Anyone** → Deploy → copy the URL ending in `/exec`.

## 3. Connect the site
Edit `js/config.js`, set `API_URL: 'https://script.google.com/macros/s/.../exec'`, commit and push (run `push-changes.bat`).

## 4. Cloudflare Pages
Connect this GitHub repo (its own repo, separate from any other project), build command empty, output directory `/`. The app is then at the site root.

## Using it
- **Enter receipts** (no login): district → number of receipts in hand → fill Receipt no., Total, Cash, UPI, Account per row → Submit. Cash + UPI + Account must equal the total.
- **Admin login** (default key `1234`): Summary, edit/delete receipts, add/rename/delete districts, PROFCON expenses, report PDF (download / share / email), and **Settings → change key**. Change the default key straight away.
- **Email PDF** sends from your Google account (Gmail limit ~100 mails/day).
- After editing Code.gs: **Deploy → Manage deployments → ✏ → New version → Deploy** (URL stays the same).
- Never share the sheet itself with the district people; they only use the site.
