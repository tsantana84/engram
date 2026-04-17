# Supabase URL Environment Variable Issue

## Error
```
Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.
```

## Root Cause
When setting `SUPABASE_URL` via Vercel CLI, the value was likely saved with extra whitespace/newlines.

The expected value:
```
https://oqbnrnhnzugrqypkpuce.supabase.co
```

What was likely saved:
```
https://oqbnrnhnzugrqypkpuce.supabase.co
(with leading/trailing whitespace or newlines)
```

## Solution

Set the environment variables **manually** via the Vercel dashboard:

1. Go to: https://vercel.com/dashboard/thiagos-projects-503c8f7a/engram/settings/environment-variables
2. Delete both `SUPABASE_URL` and `SUPABASE_ANON_KEY`
3. Add them manually (copy-paste the values directly):

**SUPABASE_URL:**
```
https://oqbnrnhnzugrqypkpuce.supabase.co
```

**SUPABASE_ANON_KEY:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xYm5ybmhuenVncnF5cGtwdWNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTAxNDksImV4cCI6MjA5MTc2NjE0OX0.abchvI0EVsuvpygAsuqnY3WhN1axW6G_zDt35HOdXYQ
```

4. Save and redeploy

## Why CLI Failed

The Vercel CLI's `vercel env add` command reads from stdin, and piping values with `echo | vercel env add` or `printf | vercel env add` often adds invisible whitespace/newlines to the value.

Manual paste in the dashboard avoids this.

## After Fix

Redeploy the project and test:
```
curl https://engram-ashy.vercel.app/api/db-check
curl https://engram-ashy.vercel.app/api/agents
```
