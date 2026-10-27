# Air Force Fitness Prep

A private, phone-friendly training log built as a small web app. It is designed for one person and uses a Cloudflare Worker, a D1 database, and an optional Telegram reminder.

## Before you begin

The app is deployed as a private Cloudflare Worker and can be updated through the connected GitHub repository. It uses the current general Air Force PFRA standards in `data/scoring.json`. In Settings, enter your own starting results; the visible example values are editable.

The temporary ship date is February 1, 2027. The Settings date field is editable. Training plans include three runs each week and rotate sit-ups, cross-leg reverse crunches, and planks.

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

## 4. Upload or update the project on GitHub

1. Open your `air-force-fitness-prep` repository on [GitHub](https://github.com/).
2. Choose **Add file → Upload files**.
3. On your Mac, double-click the project ZIP to extract it. Drag the project files and folders onto GitHub's upload page. For an update, upload the new `src`, `worker`, `data`, `scripts`, and `config` folders and the updated root files. Keep the repository's existing `.github` folder and `.gitignore`; do not upload `outputs`, `work`, or `.DS_Store`.
4. Choose **Commit changes** and commit to `main`.
5. Open the repository's **Actions** tab and wait for **Build and deploy** to finish successfully. The app updates when that run succeeds.

## 5. Add the app's private passphrase

After the first successful deployment:

1. In Cloudflare, open **Workers & Pages**, then select the Worker named `air-force-fitness-prep`.
2. Open its **Settings → Variables and Secrets** section and add these secrets:
   - `PASS_PHRASE` — choose a long private phrase you can remember. You will enter it when opening the app.
   - `SESSION_SECRET` — create a random secret. On a Mac, open Terminal and run `openssl rand -base64 32`; copy the printed value into Cloudflare. Do not put this value in GitHub files.
3. Save the changes and redeploy the Worker from its **Deployments** page if Cloudflare asks you to.

The first page is protected by the passphrase. The app does not have accounts or a sign-up screen.

## 6. Optional: set up Telegram reminders

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

## 7. Open the app and add your settings

1. In Cloudflare, open the Worker’s **Overview** page and click its `workers.dev` address. It looks like `https://air-force-fitness-prep.<your-subdomain>.workers.dev`.
2. Enter the `PASS_PHRASE` you created.
3. Choose the gear icon and enter your ship date, timezone, morning message time, baselines, age bracket, and sex category. Telegram can stay off.
4. The official score chart is already included. Score calculation needs push-ups, one selected core event, a two-mile time, waist, and height. A training plan also needs editable baseline results for push-ups, sit-ups, cross-leg reverse crunches, plank, and the two-mile run.

## 8. Add to your iPhone Home Screen

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

`data/scoring.schema.md` documents the format. The official scoring source, age/sex records, component minimums, and score bands are in `data/scoring.json`. Run the validator to check the score data structure:

```sh
npm run validate:scoring
```

The app starts with a temporary ship date of February 1, 2027. Replace the editable example results in Settings with your own push-up, sit-up, cross-leg reverse crunch, plank, and 2-mile run baselines. A plan is generated after those results are entered. When you save updated settings, the app refreshes today's plan and future pending plans.

The workout screen includes at least 10 push-ups every day, with additional push-ups on scheduled strength days. Running is scheduled three times per week. Weekly push-up and running volume, plus each core-event target, are capped at a 15% increase over the previous week; recovery weeks and the five-day taper reduce the workload. Settings lets you choose a rest timer from 15 to 300 seconds (default 60). The app uses Times New Roman and shows a brief star animation when you finish a set.

## Performance audit

The app uses plain CSS, inline SVG, and small image icons, but a Lighthouse score has **not** been measured yet because the project packages are not installed in this workspace. After the app is deployed, you can check it in Chrome on your Mac: open the app, open **View → Developer → Developer Tools → Lighthouse**, choose **Mobile**, and run the report. The target is a Performance score of 90 or higher; a real score needs to be measured on the deployed app.

## Useful commands

```sh
npm test                    # Run the plan, score, and reminder helper checks
npm run build               # Type-check and build the web app and Worker
npm run validate:scoring    # Check official scoring data structure
npm run db:migrate:local    # Prepare a local development database
npm run db:migrate:remote   # Apply database migrations to Cloudflare
```

## Project files

- `src/` — mobile app, API client, and deterministic plan and score engines.
- `worker/` — authenticated API, scheduled reminder, and Telegram message formatting.
- `migrations/` — D1 database tables.
- `data/scoring.json` — official current PFRA score bands for all age brackets and scoring categories.
- `config/plan.ts` — editable plan settings, including the approved 15% weekly cap and 5-day taper.
- `.github/workflows/deploy.yml` — checks, database migrations, and deployment on pushes to `main`.
