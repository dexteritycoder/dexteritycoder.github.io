# dexteritycoder.github.io

I am Abhinav, a BCA student at the University of Allahabad and the technical co-founder of Crossdale Arts. I have been writing code since I was thirteen and I care deeply about understanding every layer of what I build rather than operating at the surface of abstractions.

I built this site because I needed one place that honestly represents what I do and how I think. Not a resume, not a template filled with stock descriptions, but an actual reflection of the work I take seriously. It holds my open source projects, my writing on AI and machine learning, a blog where I think out loud, and a page for freelance work.

The site is built with plain HTML, CSS, and JavaScript, hosted on GitHub Pages. No framework, no build step. A personal portfolio does not need more than that, and keeping the stack minimal means I own every line of what runs here.

*dexteritycoder - GitHub, Instagram*

## Engagement storage

Comments and likes are served by `api/engagement.js`.

In local development, the handler reads and writes `data/engagement/comments.json` and `data/engagement/likes.json` directly, so engagement works without any database setup.

On Vercel, the same handler switches to Postgres when one of these environment variables is present: `POSTGRES_URL`, `DATABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_DATABASE_URL`, or `SUPABASE_POSTGRES_URL`.

Supabase is the recommended deployment target here because the API already uses PostgreSQL directly. Once the connection string is added in Vercel, the handler creates its tables automatically, seeds the initial data from the legacy JSON files on first connect, and serves shared likes/comments to every visitor.

The frontend now re-syncs engagement data in the background, on tab focus, and when the page becomes visible again, so likes and comments added on one device appear on other devices without requiring a hard refresh.
