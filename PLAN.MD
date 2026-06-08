** Features and Improvements **

1. Video Player:
    - Add video player package to the app
    - Implement video player from https://github.com/vidstack/player
    - Use an external FFMPEG service for sprite generation for scrollbar hover preview thumbnails.

2. TikTok Scraper for Avatars and User Info:
    - The most reliable package for Docker integration is tiktok-scraper via Node.js. It allows you to fetch full user profiles—including high-resolution avatar URLs—via a Command Line Interface (CLI) or a JavaScript script.
    - Package: tiktok-scraper (npm)
    - Docker Setup: Install Node.js in your container and run npm install -g tiktok-scraper
    - Execution Command: tiktok-scraper user <username> -d (This outputs a JSON file containing the avatar and avatarLarger URLs).
    - Only run once per user to fetch and store avatar and user info data (username, display name, bio, etc.)

3.  Optimized and Enhanced UI/UX:
    - Add a navbar element that shows a countdown to the next user live status check (e.g., "Next check in: 5m 30s") This is connected to the backend settings configurable status check time input.
    - Add a navbar check live status manual refresh button, will reset app timer for checks and trigger an immediate status check.
    - Ensure live status checking and recording monitoring is foolproof and handles edge cases gracefully.
    - Ensure app is responsive and works on all screen sizes.

4. Watch page:
    - Processing indicator on thumbnails/cards for recordings that are still processing and not yet available for viewing.

5. Recordings page:
    - Allow filtering by file size, date, user, etc.
    - Allow sorting by file size, date, user, etc.

6. Transcribing finished recordings (completed or stopped):
    - Use a FasterWhisper service (https://github.com/SYSTRAN/faster-whisper) for accurate transcription.
    - Store transcriptions in a database or file.
    - Allow searching recordings by transcription text with timestamps for the searched text.