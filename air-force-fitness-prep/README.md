# Air Force Fitness Prep

A private, phone-friendly training log built as a small web app. It is designed for one person and uses a Cloudflare Worker, a D1 database, and an optional Telegram reminder.

## Before you begin

The project files are ready, but it is **not published or running online yet**. You will need a GitHub account, a free Cloudflare account, and a Telegram account if you want the morning messages. The app will not calculate scores or create workout targets until verified official standards are added to `data/scoring.json`; that file intentionally contains placeholders today.

The setup is a one-time process. After the first deployment, changes pushed to the `main` branch deploy automatically.

## 1. Create an empty, private GitHub repository

1. Sign in at [GitHub](https://github.com/).
2. Click the **+** button near the upper-right corner, then choose **New repository**.
3. Name it `air-force-fitness-prep`, select **Private**, and leave the options to add a README, `.gitignore`, or license unchecked. Choose **Create repository**.

This empty repository is where the project files will go after the Cloudflare account is ready.

## 2. Create the Cloudflare database

1. Sign in to [Cloudflare](https://dash.cloudflare.com/) and open **Workers & Pages → D1 SQL Database**.
2. Choose **Create database** and name it `fitness-prep`.
3. Open `wrangler.jsonc` in the project. Find the `database_id` value under `d1_databases` and replace `00000000-0000-0000-0000-000000000000` with the ID Cloudflare displayed for the database. Save the file.
4. In **Workers & Pages**, choose **Create application → Create Worker → Deploy**. Name the Worker `air-force-fitness-prep`. This creates the empty Worker that GitHub will update.
5. In Codex, open `wrangler.jsonc` from the project file list. Replace only the all-zero `database_id` value with the database ID Cloudflare displayed, then save the file.

Cloudflare's documentation describes [creating a Worker in the dashboard](https://developers.cloudflare.com/workers/get-started/dashboard/), [creating a D1 database](https://developers.cloudflare.com/d1/get-started/), and [applying D1 migrations](https://developers.cloudflare.com/d1/wrangler-commands/). This project’s GitHub deployment workflow applies the included migration automatically.

## 3. Let GitHub deploy to Cloudflare

### Create a Cloudflare API token

1. In Cloudflare, open **My Profile → API Tokens → Create Token**.
2. Create a custom token scoped to your Cloudflare account. Give it **Workers Editor** access (or use the **Edit Cloudflare Workers** template) and **D1: Edit** permission. The Worker permission updates the Worker you created above; the D1 permission lets the workflow apply the database migration.
3. Copy the token and keep it private. You will paste it into GitHub's secret storage, not into a project file.
4. Find your Cloudflare **Account ID** in the account overview.

### Save the two GitHub secrets

1. Open your GitHub repository and choose **Settings → Secrets and variables → Actions**.
2. Choose **New repository secret** and add:
   - `CLOUDFLARE_API_TOKEN` — the token you just created.
   - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.
3. Leave this GitHub page open; the project files will be pushed in the next section.

The workflow runs the app checks, builds the project, applies database migrations, and deploys the Worker on every push to `main`. Cloudflare requires an API token and account ID for GitHub Actions deployments. [Cloudflare GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)

## 4. Copy the project into GitHub Desktop and deploy it

1. Install [GitHub Desktop](https://desktop.github.com/) and sign in.
2. In GitHub Desktop, choose **File → Clone Repository**, select `air-force-fitness-prep`, and choose a local folder such as **Documents**.
3. In Finder, press **Command+Shift+G**, paste `/Users/tobinspiller/Documents/Codex/2026-10-26/files-pasted-by-the-user-project`, and press Return to open this project. Open the new cloned `air-force-fitness-prep` folder in a second Finder window. In the project folder, press **Command+A**, then **Command+C**. In the cloned folder, press **Command+Shift+.** to show hidden items, then **Command+V**. Copy the project files and folders, including `.github` and `.gitignore`; do not replace the cloned folder’s hidden `.git` folder.
4. Return to GitHub Desktop. In the **Summary** box, type `Initial app setup`, click **Commit to main**, then click **Push origin**.
5. Open the repository’s **Actions** tab and wait for **Build and deploy** to finish successfully. If it fails, open that run and share the error with me; I can help you fix it.

## 4. Add the app's private passphrase

After the first successful deployment:

1. In Cloudflare, open **Workers & Pages**, then select the Worker named `air-force-fitness-prep`.
2. Open its **Settings → Variables and Secrets** section and add these secrets:
   - `PASS_PHRASE` — choose a long private phrase you can remember. You will enter it when opening the app.
   - `SESSION_SECRET` — create a random secret. On a Mac, open Terminal and run `openssl rand -base64 32`; copy the printed value into Cloudflare. Do not put this value in GitHub files.
3. Save the changes and redeploy the Worker from its **Deployments** page if Cloudflare asks you to.

The first page is protected by the passphrase. The app does not have accounts or a sign-up screen.

## 5. Optional: set up Telegram reminders

You can skip this section and leave Telegram switched off.

1. In Telegram, search for **@BotFather**, open its verified chat, and send `/newbot`.
2. Follow its prompts to name your bot. Copy the bot token it gives you and keep it private.
3. Open your new bot in Telegram and send `/start` so it can message you.
4. To get your numeric Telegram user ID for a personal chat, search for **@userinfobot** and follow its instructions. This shares that numeric ID with the helper bot; you can instead use Telegram's official [Bot API `getUpdates` method](https://core.telegram.org/bots/api#getupdates) if you prefer.
5. In Cloudflare Worker **Settings → Variables and Secrets**, add:
   - `TELEGRAM_BOT_TOKEN` — the token from BotFather.
   - `TELEGRAM_CHAT_ID` — your numeric Telegram user ID.
6. Open the app, choose the gear icon, turn on **Telegram messages**, and save. The default reminder time is 6:30 a.m. in the timezone shown in Settings.

The scheduled Worker checks once a minute and sends at the exact configured local time. It records each successful daily send to prevent duplicate reminders.

## 6. Open the app and add your settings

1. In Cloudflare, open the Worker’s **Overview** page and click its `workers.dev` address. It looks like `https://air-force-fitness-prep.<your-subdomain>.workers.dev`.
2. Enter the `PASS_PHRASE` you created.
3. Choose the gear icon and enter your ship date, timezone, morning message time, baselines, age bracket, and sex category. Telegram can stay off.
4. The Score tab can save your test results now. Score calculation and training targets stay unavailable until the official standards are loaded and validated.

## 7. Add to your iPhone Home Screen

1. Open the app address in **Safari** on your iPhone and sign in.
2. Tap **Share** (the square with the up arrow).
3. Scroll down and tap **Add to Home Screen**, then tap **Add**.
4. Open **Fit Prep** from the new Home Screen icon. The app needs an internet connection to sign in and sync data; previously loaded screens and queued set logs can work offline and sync when the phone reconnects.

## Optional: run it on your Mac

To preview the app locally, install the current Node.js LTS release from [nodejs.org](https://nodejs.org/), open Terminal in this project folder, and create a file named `.dev.vars` with these two lines (choose your own local-only values):

```text
PASS_PHRASE="a-private-local-passphrase"
SESSION_SECRET="a-long-random-local-secret"
```

Then run:

```sh
npm install
npm run db:migrate:local
npm run dev
```

Terminal will show a local address, usually `http://localhost:5173`. Open that address in your browser. Local API access also needs a `.dev.vars` file with `PASS_PHRASE` and `SESSION_SECRET`; `.dev.vars` is ignored by Git so its values are not committed. Local preview is optional; the GitHub workflow deploys the app.

## Scoring data

`data/scoring.schema.md` documents the required format. The official scoring source, age/sex records, component minimums, and score bands belong in `data/scoring.json`. Do not use estimated or remembered standards. The validator intentionally exits with an error until all placeholders have been replaced with verified source data:

```sh
npm run validate:scoring
```

Once scoring data is loaded, the plan also needs your ship date, age/sex profile, and all four baseline measurements in Settings. Existing saved day plans remain snapshots; changing settings does not rewrite earlier days.

## Performance audit

The app uses plain CSS, inline SVG, and small image icons, but a Lighthouse score has **not** been measured yet because the project packages are not installed in this workspace. After the app is deployed, you can check it in Chrome on your Mac: open the app, open **View → Developer → Developer Tools → Lighthouse**, choose **Mobile**, and run the report. The target is a Performance score of 90 or higher; a real score needs to be measured on the deployed app.

## Useful commands

```sh
npm test                    # Run the plan, score, and reminder helper checks
npm run build               # Type-check and build the web app and Worker
npm run validate:scoring    # Confirm there are no scoring placeholders
npm run db:migrate:local    # Prepare a local development database
npm run db:migrate:remote   # Apply database migrations to Cloudflare
```

## Project files

- `src/` — mobile app, API client, and deterministic plan and score engines.
- `worker/` — authenticated API, scheduled reminder, and Telegram message formatting.
- `migrations/` — D1 database tables.
- `data/scoring.json` — official score data location, currently a guarded placeholder.
- `config/plan.ts` — editable plan settings, including the approved 15% weekly cap and 5-day taper.
- `.github/workflows/deploy.yml` — checks, database migrations, and deployment on pushes to `main`.
