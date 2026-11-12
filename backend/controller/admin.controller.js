const mongoose = require('mongoose');
const DeadlockMatch = require("../model/deadlock.model");
const Team = require("../model/team.model");
const DeadlockQuestion = require("../model/deadlockQuestion");
const DeadlockSubmission = require("../model/deadlockSubmission.model");
const GameState = require("../model/gameState.model");
const { clearAllSecurityLogs } = require("./admin/security.controller");

/* ----------------------------------------------------
CREATE DEADLOCK MATCH
---------------------------------------------------- */
exports.createMatch = async (req, res) => {
    try {
        const match = await DeadlockMatch.create({
            tugPosition: 0,
            maxPull: 3,
            status: "lobby"
        });

        res.status(201).json({
            success: true,
            match
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to create match",
            error: err.message
        });
    }
};

/* ----------------------------------------------------
RESET MATCH
---------------------------------------------------- */
exports.resetMatch = async (req, res) => {
    try {
        const { id } = req.params;

        const match = await DeadlockMatch.findByIdAndUpdate(
            id,
            {
                tugPosition: 0,
                winner: null,
                loser: null,
                status: "ongoing"
            },
            { new: true }
        );

        if (!match) {
            return res.status(404).json({
                success: false,
                message: "Match not found"
            });
        }

        res.json({
            success: true,
            message: "Match reset successfully",
            match
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to reset match",
            error: err.message
        });
    }
};

/* ----------------------------------------------------
ASSIGN TEAMS TO MATCH
---------------------------------------------------- */
exports.updateTeams = async (req, res) => {
    try {
        const { id } = req.params;
        const { teamA, teamB } = req.body;

        if (!teamA || !teamB) {
            return res.status(400).json({
                success: false,
                message: "Both teamA and teamB are required"
            });
        }

        const teamAExists = await Team.findOne({
            _id: teamA,
            currentRound: "deadlock",
            deadlockResult: "pending"
        });

        const teamBExists = await Team.findOne({
            _id: teamB,
            currentRound: "deadlock",
            deadlockResult: "pending"
        });

        if (!teamAExists || !teamBExists) {
            return res.status(404).json({
                success: false,
                message: "One or both teams are not eligible for Deadlock"
            });
        }

        const match = await DeadlockMatch.findByIdAndUpdate(
            id,
            {
                teamA,
                teamB,
                status: "ongoing"
            },
            { new: true }
        );

        if (!match) {
            return res.status(404).json({
                success: false,
                message: "Match not found"
            });
        }

        res.json({
            success: true,
            match
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to update teams",
            error: err.message
        });
    }
};

/* ----------------------------------------------------
SWAP TEAMS
---------------------------------------------------- */
exports.swapTeams = async (req, res) => {
    try {
        const { id } = req.params;

        const match = await DeadlockMatch.findById(id);

        if (!match || !match.teamA || !match.teamB) {
            return res.status(404).json({
                success: false,
                message: "Match or teams not found"
            });
        }

        const temp = match.teamA;
        match.teamA = match.teamB;
        match.teamB = temp;

        await match.save();

        res.json({
            success: true,
            match
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to swap teams",
            error: err.message
        });
    }
};

/* ----------------------------------------------------
FINISH MATCH (PROMOTION LOGIC)
---------------------------------------------------- */
exports.finishMatch = async (req, res) => {
    try {
        const { id } = req.params;
        const { winner } = req.body;

        if (!winner) {
            return res.status(400).json({
                success: false,
                message: "Winner team ID is required"
            });
        }

        let match;

        // Optimized: If ID is provided (and likely valid ObjectId), try to find by ID
        if (id && mongoose.Types.ObjectId.isValid(id)) {
            match = await DeadlockMatch.findById(id);
        }

        // Fallback: If no match found yet (or no ID), try to find active match by Team ID
        if (!match) {
            match = await DeadlockMatch.findOne({
                $or: [{ teamA: winner }, { teamB: winner }],
                status: { $in: ['ongoing', 'lobby'] }
            });
        }

        if (!match || !match.teamA || !match.teamB) {
            return res.status(404).json({
                success: false,
                message: "Active match not found for this team"
            });
        }

        const loser =
            winner.toString() === match.teamA.toString()
                ? match.teamB
                : match.teamA;

        match.status = "finished";
        match.winner = winner;
        match.loser = loser;

        // SYMBOLIC FIX: Set tugPosition to the win threshold for consistent UI
        if (winner.toString() === match.teamA?.toString()) {
            match.tugPosition = -match.maxPull;
        } else {
            match.tugPosition = match.maxPull;
        }

        await match.save();

        await Team.findByIdAndUpdate(winner, {
            currentRound: "crack-the-code",
            deadlockResult: "win"
        });

        await Team.findByIdAndUpdate(loser, {
            currentRound: "eliminated",
            deadlockResult: "lose"
        });

        res.json({
            success: true,
            message: "Match finished and teams updated",
            match
        });

        // ATOMIC FIRST BLOOD ASSIGNMENT
        // Ensure state exists, then assign if firstBloodTeamId is null.
        await GameState.get();
        await GameState.updateOne(
            { key: 'GLOBAL_STATE', firstBloodTeamId: null },
            { $set: { firstBloodTeamId: winner } }
        );
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to finish match",
            error: err.message
        });
    }
};

/* ----------------------------------------------------
GET DEADLOCK TEAMS (ELIGIBLE ONLY)
---------------------------------------------------- */
exports.getTeam = async (req, res) => {
    try {
        // Fetch all teams eligible for deadlock round (pending results)
        // Teams start in 'pending' round and move to 'deadlock' when initialized
        const teams = await Team.find({
            currentRound: "pending",
            deadlockResult: "pending"
        }).select("name members currentRound");

        res.json({
            success: true,
            teams
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch deadlock teams",
            error: err.message
        });
    }
};

/* ----------------------------------------------------
GET ACTIVE DEADLOCK MATCHES
---------------------------------------------------- */
exports.getMatches = async (req, res) => {
    try {
        // Only fetch matches from the last 2 hours to avoid stale/duplicate historical data
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const matches = await DeadlockMatch.find({
            status: { $in: ["lobby", "ongoing", "finished"] },
            createdAt: { $gte: twoHoursAgo }
        })
            .sort({ createdAt: -1 }) // Show newest first
            .populate("teamA", "name members currentRound")
            .populate("teamB", "name members currentRound");

        res.json({
            success: true,
            matches
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch active matches",
            error: err.message
        });
    }
};

const CrackCodeSession = require("../model/CrackCodeSession");
const CrackCodeSubmission = require("../model/CrackCodeSubmission");
const CrackCodeAttempt = require("../model/CrackCodeAttempt");

/* ----------------------------------------------------
TERMINATE SESSION (NUCLEAR RESET)
---------------------------------------------------- */
exports.terminateSession = async (req, res) => {
    try {
        // 1. Delete all matches and submissions
        await DeadlockMatch.deleteMany({});
        await DeadlockSubmission.deleteMany({});

        // 2. Clear all Crack the Code data
        await CrackCodeSession.deleteMany({});
        await CrackCodeSubmission.deleteMany({});
        await CrackCodeAttempt.deleteMany({});

        // 3. Reset Global Game State (Clear First Blood)
        await GameState.updateOne(
            { key: 'GLOBAL_STATE' },
            {
                $set: {
                    firstBloodTeamId: null,
                    glitchUsed: false,
                    glitchActiveUntil: null
                }
            },
            { upsert: true }
        );

        // 4. Clear stored security violation logs and notify open admin consoles
        await clearAllSecurityLogs(req.app.get("io"));

        // 5. Deep reset all teams to factory defaults for the round
        await Team.updateMany({}, {
            deadlockResult: 'pending',
            currentRound: 'pending',
            currentQuestionIndex: 0,
            questions: [],
            isActive: true
        });

        res.json({
            success: true,
            message: "Session terminated. All systems, security logs, Crack Code data, and Global State reset to baseline."
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to terminate session",
            error: err.message
        });
    }
};

/* ----------------------------------------------------
CREATE TEAM
---------------------------------------------------- */
exports.createTeam = async (req, res) => {
    try {
        const { name, members } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: "Team name is required"
            });
        }

        const team = await Team.create({
            name,
            members: members || [],
            currentRound: "pending",
            deadlockResult: "pending"
        });

        res.status(201).json({
            success: true,
            team
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to create team",
            error: error.message
        });
    }
};

exports.solveProblem = async (req, res) => {
    try {
        const { matchId, solvingTeamId } = req.body;

        const match = await DeadlockMatch.findById(matchId);

        if (!match || match.status !== "ongoing") {
            return res.status(400).json({
                success: false,
                message: "Match not active"
            });
        }

        match.tugPosition += 1;

        if (Math.abs(match.tugPosition) >= match.maxPull) {
            const winner = solvingTeamId;
            const loser =
                solvingTeamId.toString() === match.teamA.toString()
                    ? match.teamB
                    : match.teamA;

            match.status = "finished";
            match.winner = winner;
            match.loser = loser;
            await match.save();

            // Promote winner
            await Team.findByIdAndUpdate(winner, {
                currentRound: "crack-the-code",
                deadlockResult: "win"
            });

            // Eliminate loser
            await Team.findByIdAndUpdate(loser, {
                currentRound: "eliminated",
                deadlockResult: "lose"
            });

            // Atomic Awakening (First Blood) assignment
            await GameState.get();
            await GameState.updateOne(
                { key: 'GLOBAL_STATE', firstBloodTeamId: null },
                { $set: { firstBloodTeamId: winner } }
            );

            return res.json({
                success: true,
                message: "Match won! Team advanced to Crack the Code",
                winner
            });
        }

        // If not yet won
        await match.save();

        res.json({
            success: true,
            message: "Problem solved, game continues",
            tugPosition: match.tugPosition
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Failed to process solve",
            error: err.message
        });
    }
};


/* ----------------------------------------------------
START ALL DEADLOCK MATCHES (BATCH)
---------------------------------------------------- */
exports.startAllDeadlockMatches = async (req, res) => {
    try {
        const { teamAIds, teamBIds } = req.body;

        if (!teamAIds || !teamBIds || teamAIds.length !== teamBIds.length) {
            return res.status(400).json({
                success: false,
                message: "Valid team Alpha and Team Omega pairings are required"
            });
        }

        // Get all available questions from the pool
        const allQuestions = await DeadlockQuestion.find({});
        console.log(`[INIT] Found ${allQuestions.length} total questions.`);

        if (allQuestions.length < 30) {
            console.error(`[INIT] Threshold failure: ${allQuestions.length} < 30`);
            return res.status(500).json({
                success: false,
                message: "Not enough questions in the database pool (need at least 30).",
                error: `Database has only ${allQuestions.length} questions. Ensure the seeder was run correctly.`
            });
        }

        // --- ATOMIC GLOBAL STATE RESET ---
        // Every time we start a new round of matches, reset First Blood and glitch ability
        await GameState.updateOne(
            { key: 'GLOBAL_STATE' },
            {
                $set: {
                    firstBloodTeamId: null,
                    glitchUsed: false,
                    glitchActiveUntil: null
                }
            },
            { upsert: true }
        );
        // ---------------------------------

        const matches = [];

        // Pair teams & create matches
        for (let i = 0; i < teamAIds.length; i++) {
            const teamAId = teamAIds[i];
            const teamBId = teamBIds[i];

            // CLEANUP: Force-delete ALL previous matches (ongoing OR finished) for these teams
            await DeadlockMatch.deleteMany({
                $or: [
                    { teamA: { $in: [teamAId, teamBId] } },
                    { teamB: { $in: [teamAId, teamBId] } }
                ]
            });

            // GUARD: Prevent a team from playing itself
            if (teamAId.toString() === teamBId.toString()) continue;

            // Officially move teams to deadlock round
            await Team.updateMany(
                { _id: { $in: [teamAId, teamBId] } },
                { currentRound: "deadlock" }
            );

            // Start with only ONE random EASY question.
            // The dynamic difficulty logic in solve endpoint will fetch the next medium/hard 
            // questions based on tugPosition.
            const easyQuestions = allQuestions.filter(q => q.difficulty === "easy");

            if (easyQuestions.length === 0) {
                console.error("CRITICAL: No easy questions found in pool!");
                throw new Error("Initialization failed: No easy questions available in the question pool.");
            }

            const firstQuestion = easyQuestions[Math.floor(Math.random() * easyQuestions.length)];

            const match = await DeadlockMatch.create({
                teamA: teamAId,
                teamB: teamBId,
                questions: [firstQuestion._id],
                currentQuestionIndex: 0,
                tugPosition: 0,
                maxPull: 3,
                status: "ongoing"
            });

            matches.push(match);
        }

        res.status(201).json({
            success: true,
            message: `Initialization complete. Matches: ${matches.length}`,
            totalMatches: matches.length,
            matches
        });

    } catch (err) {
        console.error("Batch match failed:", err);
        res.status(500).json({
            success: false,
            message: "Failed to initialize matches",
            error: err.message
        });
    }
};

/* ----------------------------------------------------
GET MATCH BY TEAM NAME
---------------------------------------------------- */
exports.getMatchByTeamName = async (req, res) => {
    try {
        const { name } = req.params;
        const team = await Team.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });

        if (!team) {
            return res.status(404).json({ success: false, message: "Team not found" });
        }

        const match = await DeadlockMatch.findOne({
            $or: [{ teamA: team._id }, { teamB: team._id }],
            status: { $in: ["ongoing", "lobby"] }
        }).populate("teamA teamB", "name");

        if (!match) {
            return res.status(404).json({ success: false, message: "No active match found for this team" });
        }

        res.json({
            success: true,
            match
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/* ----------------------------------------------------
SHUFFLE CURRENT QUESTION
---------------------------------------------------- */
exports.shuffleCurrentQuestion = async (req, res) => {
    try {
        const { id } = req.params;
        const match = await DeadlockMatch.findById(id);

        if (!match || match.status !== "ongoing") {
            return res.status(404).json({ success: false, message: "Active match not found" });
        }

        // Determine target difficulty based on current tugPosition
        const absPos = Math.abs(match.tugPosition);
        let difficulty = "medium";
        if (absPos >= 3) difficulty = "hard";
        else if (absPos === 0) difficulty = "easy";

        const usedQuestionIds = match.questions || [];

        // Find a new question of the same difficulty
        const count = await DeadlockQuestion.countDocuments({
            difficulty,
            _id: { $nin: usedQuestionIds }
        });

        if (count === 0) {
            return res.status(404).json({ success: false, message: "No alternative questions of this difficulty found" });
        }

        const randomSkip = Math.floor(Math.random() * count);
        const newQuestion = await DeadlockQuestion.findOne({
            difficulty,
            _id: { $nin: usedQuestionIds }
        }).skip(randomSkip);

        if (!newQuestion) {
            return res.status(404).json({ success: false, message: "Failed to fetch new question" });
        }

        // Replace the question at the current index
        match.questions[match.currentQuestionIndex] = newQuestion._id;
        await match.save();

        res.json({
            success: true,
            message: "Question shuffled successfully",
            newQuestionTitle: newQuestion.title
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/* ----------------------------------------------------
CHECK TEAM EXISTENCE
---------------------------------------------------- */
exports.checkTeam = async (req, res) => {
    try {
        const name = req.params.name || req.body.name;

        // Case-insensitive search
        const team = await Team.findOne({
            name: { $regex: new RegExp(`^${name}$`, 'i') }
        });

        if (team) {
            return res.json({
                success: true,
                exists: true,
                team: {
                    _id: team._id,
                    name: team.name,
                    members: team.members,
                    currentRound: team.currentRound
                }
            });
        }

        res.json({
            success: true,
            exists: false
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to check team",
            error: error.message
        });
    }
};

/* ----------------------------------------------------
PROMOTE TEAM (FORCE WIN)
---------------------------------------------------- */
exports.promoteTeam = async (req, res) => {
    try {
        const { matchId, winnerTeamId } = req.body;
        const match = await DeadlockMatch.findById(matchId);

        if (!match || match.status === "finished") {
            return res.status(404).json({ success: false, message: "Active match not found" });
        }

        let loserTeamId = null;
        if (match.teamA.toString() === winnerTeamId) {
            loserTeamId = match.teamB;
        } else if (match.teamB.toString() === winnerTeamId) {
            loserTeamId = match.teamA;
        } else {
            return res.status(400).json({ success: false, message: "Winner team not part of this match" });
        }

        // Finalize match
        match.status = "finished";
        match.winner = winnerTeamId;
        match.loser = loserTeamId;

        // Push the momentum to the winning side
        match.tugPosition = (match.teamA.toString() === winnerTeamId) ? -4 : 4;

        await match.save();

        // Update team records
        await Team.findByIdAndUpdate(winnerTeamId, {
            currentRound: "crack-the-code",
            deadlockResult: "win"
        });

        await Team.findByIdAndUpdate(loserTeamId, {
            currentRound: "eliminated",
            deadlockResult: "lose"
        });

        // ATOMIC FIRST BLOOD ASSIGNMENT
        // Ensure state exists, then assign if firstBloodTeamId is null.
        await GameState.get();
        await GameState.updateOne(
            { key: 'GLOBAL_STATE', firstBloodTeamId: null },
            { $set: { firstBloodTeamId: winnerTeamId } }
        );

        res.json({
            success: true,
            message: "Team promoted successfully",
            winnerId: winnerTeamId
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
