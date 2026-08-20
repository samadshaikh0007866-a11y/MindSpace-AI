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
const { db, stmts } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

/* ===== Middleware ===== */

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

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

/* ===== Start server ===== */

app.listen(PORT, () => {

    console.log(`MindSpace backend running at http://localhost:${PORT}`);

    console.log(`Database at ${require("path").join(__dirname, "data", "mindspace.db")}`);

});
