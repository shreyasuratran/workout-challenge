# Workout Challenge

A private mobile-first workout challenge app for Shreya, Aditi, and Thaanvi.

Built with React, Vite, TypeScript, Tailwind CSS, Supabase, date-fns, and lucide-react.

## Features

- Profile picker for personal friends
- Selected profile saved in `localStorage`
- Daily workout check-in
- One check-in per person per day
- Undo is allowed only for today's check-in
- Home dashboard with all three friends' today status
- Current streaks for everyone
- Weekly leaderboard
- Personal weekly goal, defaulting to 4 days per week
- Settings page to change weekly goals and switch profile
- History page with recent check-ins
- Mobile-first bottom navigation

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project at [supabase.com](https://supabase.com).

3. In Supabase, open **SQL Editor** and run the full contents of:

   ```bash
   supabase/schema.sql
   ```

4. In Supabase, open **Project Settings > API** and copy:

   - Project URL
   - anon public key

5. Create a local env file:

   ```bash
   cp .env.example .env.local
   ```

6. Fill in `.env.local`:

   ```bash
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

7. Start the app:

   ```bash
   npm run dev
   ```

## Supabase Setup Notes

The app does not use login. It relies on the anonymous Supabase key and row level security policies in `supabase/schema.sql`.

The schema creates:

- `profiles`
- `check_ins`
- seed rows for Shreya, Aditi, and Thaanvi
- RLS policies for reading profiles, updating weekly goals, reading check-ins, adding check-ins, and deleting only today's check-ins

Do not commit `.env.local`. It is ignored by Git.

## Vercel Deployment

1. Push this repo to GitHub.

2. In Vercel, create a new project from this repository.

3. Add these environment variables in **Project Settings > Environment Variables**:

   ```bash
   VITE_SUPABASE_URL
   VITE_SUPABASE_ANON_KEY
   ```

4. Use the default Vite settings:

   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`

5. Deploy.

After deploy, open the Vercel URL on a phone-sized screen and pick a profile to start checking in.
