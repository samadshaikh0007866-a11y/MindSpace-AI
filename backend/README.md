# MindSpace Backend

A Node.js + Express backend that stores user data in a **SQLite database** and provides real
signup/login authentication with server-side sessions.

## Architecture

```
backend/
├── package.json   dependencies and scripts
├── server.js      Express app: routes, session middleware, password hashing (bcrypt)
├── db.js          SQLite schema + prepared statements
└── data/
    └── mindscape.db   (created automatically on first run)
```

## How it works

1. **Signup** (`POST /api/signup`) — validates name/email/password, checks for duplicate emails,
   hashes the password with bcrypt, stores the user in the `users` table, and logs them in immediately.
2. **Login** (`POST /api/login`) — looks up the user by email (case-insensitive), verifies the
   password with bcrypt, and creates a server-side session.
3. **Session** — `express-session` keeps the logged-in user's `userId` on the server.
   The browser holds only a session cookie (`connect.sid`); no passwords or user data live in the browser.
4. **Protected routes** — `requireAuth` middleware blocks any request without an active session.
5. **Wellness data** — mood check-ins and activity completions are stored per user in
   `mood_logs` and `activities` tables, scoped to the logged-in session.

## API Reference

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/signup` | no | Create account `{ name, email, password, confirmPassword }` |
| POST | `/api/login` | no | Authenticate `{ email, password }` |
| POST | `/api/logout` | yes | End session |
| GET | `/api/me` | yes | Current user + wellness summary |
| POST | `/api/moods` | yes | Record mood `{ mood, label }` |
| GET | `/api/moods` | yes | Recent mood history |
| POST | `/api/activities` | yes | Complete activity `{ name }` |
| GET | `/api/activities` | yes | Recent activity history |

## Run it

```bash
cd backend
npm install
npm start
```

Open `http://localhost:3000` to use the frontend and API from the same origin. The server
serves the frontend pages and assets as well as the API, so login sessions work without
cross-origin cookie configuration. When deployed remotely, open the backend's public URL.

## Database schema

```sql
users (id, name, email UNIQUE, password [bcrypt hash], created_at)
mood_logs (id, user_id FK, mood, label, created_at)
activities (id, user_id FK, name, created_at)
```
