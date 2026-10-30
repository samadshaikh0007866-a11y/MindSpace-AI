/*
 * server.js — MindSpace authentication & wellness data API
 *
 * Endpoints:
 *   POST /api/signup          — create an account  { name, email, password, confirmPassword }
 *   POST /api/login           — authenticate       { email, password }
 *   POST /api/logout          — end the session
 *   GET  /api/me              — current user profile + wellness summary
 *   POST /api/moods           — record a mood check-in { mood, label }
 *   GET  /api/moods           — recent mood history
 *   POST /api/activities      — mark an activity complete { name }
 *   GET  /api/activities      — recent activity history
 *
 * Auth: express-session with a session token stored server-side.
 * Passwords: hashed with bcrypt (cost 10) before storage.
 */

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { db, stmts, aiClient } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ROOT = path.resolve(__dirname, "..");

/* ===== Middleware ===== */

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use("/assets", express.static(path.join(FRONTEND_ROOT, "assets")));
app.use("/css", express.static(path.join(FRONTEND_ROOT, "css")));
app.get("/logo.png", (req, res) => {
    res.sendFile(path.join(FRONTEND_ROOT, "logo.png"));
});

const frontendPages = new Set([
    "ai",
    "ai-companion",
    "dashboard",
    "index",
    "insights",
    "login",
    "mood-tracker",
    "settings",
    "signup",
    "wellness",
]);

app.get("/", (req, res) => {
    res.sendFile(path.join(FRONTEND_ROOT, "index.html"));
});

app.get("/:page.html", (req, res, next) => {
    if (!frontendPages.has(req.params.page)) {
        return next();
    }

    res.sendFile(path.join(FRONTEND_ROOT, `${req.params.page}.html`));
});

app.use(
    session({
        secret: process.env.SESSION_SECRET || "mindspace-dev-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 7 * 24 * 60 * 60 * 1000, /* 7 days */
            sameSite: "lax",
        },
    })
);

/* ===== Auth guard ===== */

function requireAuth(req, res, next) {

    if (!req.session.userId) {

        return res.status(401).json({
            error: "You must be logged in.",
        });

    }

    next();

}

/* ===== User model helpers ===== */

function userSafe(user) {

    const { password, ...safe } = user;

    return safe;

}

/* ===== Routes ===== */

/* --- Signup --- */

app.post("/api/signup", async (req, res) => {

    const { name, email, password, confirmPassword } = req.body || {};

    const trimmedName = (name || "").trim();

    const trimmedEmail = (email || "").trim().toLowerCase();

    /* Validations */

    if (!trimmedName || trimmedName.length < 2) {

        return res.status(400).json({

            error: "Please enter your full name.",

        });

    }

    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {

        return res.status(400).json({

            error: "Please enter a valid email address.",

        });

    }

    if (!password || password.length < 6) {

        return res.status(400).json({

            error: "Password must contain at least 6 characters.",

        });

    }

    if (password !== confirmPassword) {

        return res.status(400).json({

            error: "Passwords do not match.",

        });

    }

    /* Duplicate email */

    const existing = stmts.findByEmail.get(trimmedEmail);

    if (existing) {

        return res.status(409).json({

            error: "An account with this email already exists.",

        });

    }

    /* Hash password and insert */

    try {

        const hash = await bcrypt.hash(password, 10);

        const result = stmts.createUser.run(

            trimmedName,

            trimmedEmail,

            hash

        );

        /* Log the user in right away */

        req.session.userId = result.lastInsertRowid;

        req.session.name = trimmedName;

        res.status(201).json({

            message: "Account created successfully.",

            user: userSafe({ id: result.lastInsertRowid, name: trimmedName, email: trimmedEmail }),

        });

    } catch (err) {

        console.error("Signup error:", err);

        res.status(500).json({ error: "Something went wrong. Please try again." });

    }

});

/* --- Login --- */

app.post("/api/login", async (req, res) => {

    const { email, password } = req.body || {};

    const trimmedEmail = (email || "").trim().toLowerCase();

    if (!trimmedEmail || !password) {

        return res.status(400).json({

            error: "Please enter your email and password.",

        });

    }

    const user = stmts.findByEmail.get(trimmedEmail);

    if (!user) {

        return res.status(401).json({

            error: "No account found with this email, or the password is incorrect.",

        });

    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {

        return res.status(401).json({

            error: "No account found with this email, or the password is incorrect.",

        });

    }

    req.session.userId = user.id;

    req.session.name = user.name;

    res.json({

        message: "Login successful.",

        user: userSafe(user),

    });

});

/* --- Logout --- */

app.post("/api/logout", (req, res) => {

    req.session.destroy((err) => {

        if (err) console.error("Logout error:", err);

        res.clearCookie("connect.sid");

        res.json({ message: "Logged out." });

    });

});

/* --- Current user --- */

app.get("/api/me", (req, res) => {

    if (!req.session.userId) {

        return res.status(401).json({ error: "Not logged in." });

    }

    const user = stmts.findById.get(req.session.userId);

    if (!user) {

        return res.status(404).json({ error: "User not found." });

    }

    const latestMood = stmts.latestMood.get(user.id);

    const activitiesToday =

        stmts.countActivitiesToday.get(user.id).total;

    const recentMoods = stmts.listMoods.all(user.id);

    const recentActivities = stmts.listActivities.all(user.id);

    res.json({

        user: userSafe(user),

        wellness: {

            latestMood,

            activitiesToday,

            recentMoods: recentMoods.slice(0, 7),

            recentActivities: recentActivities.slice(0, 7),

        },

    });

});

/* --- Mood check-in --- */

app.post("/api/moods", requireAuth, (req, res) => {

    const { mood, label } = req.body || {};

    if (!mood || !label) {

        return res.status(400).json({

            error: "Please select a mood.",

        });

    }

    stmts.logMood.run(req.session.userId, mood, label);

    res.json({ message: "Mood recorded.", mood, label });

});

app.get("/api/moods", requireAuth, (req, res) => {

    res.json(stmts.listMoods.all(req.session.userId));

});

/* --- Wellness activities --- */

app.post("/api/activities", requireAuth, (req, res) => {

    const { name } = req.body || {};

    if (!name) {

        return res.status(400).json({

            error: "Please specify an activity.",

        });

    }

    stmts.completeActivity.run(req.session.userId, name);

    res.json({ message: "Activity completed.", name });

});

app.get("/api/activities", requireAuth, (req, res) => {

    res.json(stmts.listActivities.all(req.session.userId));

});

/* --- AI Companion --- */

const WELLNESS_SYSTEM_PROMPT = `
You are the MindSpace Wellness Companion, a supportive, empathetic, and non-judgmental AI.
Your goal is to help users manage their mental well-being, provide a listening ear, and suggest wellness activities.

SAFETY GUIDELINES:
- If a user expresses thoughts of self-harm, suicide, or severe crisis, you MUST respond with immediate empathy and provide crisis resource information.
- Direct them to professional help (e.g., "If you're feeling this way, please reach out to a professional or a crisis hotline like 988 in the US").
- Do not provide medical diagnoses or prescribe medication.

STYLE:
- Keep responses concise, warm, and conversational.
- Use the user's name if provided.
- Suggest wellness activities (Breathing, Mindfulness, Relaxation) when appropriate.
`;

app.post("/api/chat", requireAuth, async (req, res) => {

    const { message } = req.body || {};

    if (!message || message.trim().length === 0) {

        return res.status(400).json({ error: "Message cannot be empty." });

    }

    try {

        const userId = req.session.userId;

        const userName = req.session.name;

        /* 1. Save user message */

        stmts.saveChatMessage.run(userId, "user", message);

        /* 2. Get history for context */

        const history = stmts.getChatHistory.all(userId);

        const messages = [
            { role: "system", content: WELLNESS_SYSTEM_PROMPT + `\nUser name: ${userName}` },
            ...history
        ];

        /* 3. Call LLM */

        const completion = await aiClient.chat.completions.create({
            model: "claude-sonnet-4-6",
            messages: messages,
            max_tokens: 1000,
        });

        const aiResponse = (completion.choices && completion.choices[0] && completion.choices[0].message) 
            ? completion.choices[0].message.content 
            : "";

        /* 4. Save AI response */

        if (aiResponse) {
            stmts.saveChatMessage.run(userId, "assistant", aiResponse);
        }

        res.json({ response: aiResponse });

    } catch (err) {

        console.error("AI Chat error:", err);

        res.status(500).json({ error: "AI Companion is currently resting. Please try again later." });

    }

});

app.get("/api/chat/history", requireAuth, (req, res) => {

    res.json(stmts.getChatHistory.all(req.session.userId));

});

app.delete("/api/chat/history", requireAuth, (req, res) => {

    stmts.clearChatHistory.run(req.session.userId);

    res.json({ message: "Chat history cleared." });

});

/* --- Activity Suggestions --- */

app.get("/api/suggestions", requireAuth, async (req, res) => {

    try {

        const userId = req.session.userId;

        const latestMood = stmts.latestMood.get(userId);

        const moodLabel = latestMood ? latestMood.label : "Neutral";

        const prompt = `
            Based on the user's current mood "${moodLabel}", suggest 3 wellness activities from this list:
            - Breathing Exercise (3 min)
            - Mindfulness Meditation (5 min)
            - Relaxation Technique (5 min)
            - Gratitude Journaling (2 min)
            - Light Stretching (5 min)
            - Positive Affirmations (1 min)

            Output JSON only: { "suggestions": [{ "name": "...", "reason": "..." }] }
        `;

        const completion = await aiClient.chat.completions.create({
            model: "gpt-5-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        });

        res.json(JSON.parse(completion.choices[0].message.content));

    } catch (err) {

        console.error("Suggestions error:", err);

        /* Fallback suggestions */

        res.json({
            suggestions: [
                { name: "Breathing Exercise", reason: "Always a great way to center yourself." },
                { name: "Mindfulness", reason: "Helpful for staying present." },
                { name: "Relaxation", reason: "Great for releasing tension." }
            ]
        });

    }

});

/* ===== Start server ===== */

app.listen(PORT, () => {

    console.log(`MindSpace backend running at http://localhost:${PORT}`);

    console.log(`Database at ${require("path").join(__dirname, "data", "mindspace.db")}`);

});
