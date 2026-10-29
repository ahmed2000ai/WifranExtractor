# Operator Setup Guide

## Purpose
The Wifran Offers Extractor is an internal desktop application built to extract supermarket offers from PDF leaflets using Mistral OCR. It processes leaflets, filters out promotional text, crops item images, and syncs data to Wifran as `draft` or `needs_review` offers.

## Who Should Use It?
Wifran Data Entry Operators or Internal Admins who process weekly supermarket leaflets.

## Prerequisites
- A Windows computer (macOS/Linux are supported but Windows is the primary target).
- Access to the Mistral API Key (ask your tech lead).
- Access to the Supabase Service Role Key (ask your tech lead).
- PDF leaflets downloaded to your local machine.

## How to Install
1. Your tech lead will provide an installer (e.g. `Wifran Offers Extractor Setup.exe`).
2. Double click the installer to install the app.
3. The app will launch, but it **will not connect** until you set up your `.env.local` file.

## Configuration: The `.env.local` File

The application requires a configuration file named `.env.local` to securely connect to Mistral and Wifran.

### Creating the file
1. You should have received a `.env.example` file or a set of required variables from your admin.
2. In the folder where you installed the app (or in the same directory as the `.exe` if running a standalone build), create a plain text file named exactly `.env.local`.
   > **Note:** Make sure Windows doesn't save it as `.env.local.txt`.

### Required Variables
The operator normally only needs to fill these 4 keys:
```env
MISTRAL_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```
All other settings have safe defaults optimized for large leaflets.
**Note:** If using an old config, `SUPABASE_URL` and `SUPABASE_ANON_KEY` are still supported.

### Checking Readiness
1. Start the App.
2. Go to the **Settings** page (Sidebar).
3. Confirm all checks show a green "Ready" badge.
4. If anything is red, double check your `.env.local` file and restart the app.

## Security Reminders 🚨
- **NEVER** share your `.env.local` file or its contents on Slack, email, or GitHub.
- The `SUPABASE_SERVICE_ROLE_KEY` gives full database bypass access. It is highly sensitive.
- The app only creates `draft` or `needs_review` offers. It will **never** automatically publish offers live to customers.
