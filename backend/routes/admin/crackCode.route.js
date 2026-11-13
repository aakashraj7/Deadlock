const express = require("express");
const router = express.Router();

const Team = require("../../model/team.model");
const CrackCodeSession = require("../../model/CrackCodeSession");
const CrackCodeSubmission = require("../../model/CrackCodeSubmission");
const CrackCodeAttempt = require("../../model/CrackCodeAttempt");
const GameState = require("../../model/gameState.model");
const {
  QUESTIONS,
  DEFAULT_QUESTION_ID,
  getQuestionById,
  toAdminSummary,
} = require("../../config/crackCodeQuestions");

const getSelectedQuestionId = async () => {
  const state = await GameState.get();
  return getQuestionById(state.crackCodeQuestionId) ? state.crackCodeQuestionId : DEFAULT_QUESTION_ID;
};

/*
  GET /admin/crack-code/questions
  - Lists the available questions and which one is selected for the round
*/
router.get("/questions", async (req, res) => {
  try {
    const [activeSession, state] = await Promise.all([
      CrackCodeSession.findOne().select("questionId"),
      GameState.get(),
    ]);
    return res.json({
      questions: QUESTIONS.map(toAdminSummary),
      selectedQuestionId: await getSelectedQuestionId(),
      // While a round is running the question is locked to what the sessions were created with
      activeQuestionId: activeSession ? activeSession.questionId || DEFAULT_QUESTION_ID : null,
      locked: !!activeSession,
      roundEnded: Boolean(state.crackCodeEnded),
      roundEndedAt: state.crackCodeEndedAt || null,
    });
  } catch (error) {
    console.error("CrackCode QUESTIONS error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/*
  PUT /admin/crack-code/question
  Body: { questionId }
  - Selects the question for the next round. Rejected while a round is running.
*/
router.put("/question", async (req, res) => {
  try {
    const { questionId } = req.body || {};
    if (!getQuestionById(questionId)) {
      return res.status(400).json({ message: "Unknown questionId" });
    }
    if (await CrackCodeSession.findOne()) {
      return res.status(409).json({
        message: "Round in progress. Reset the systems before changing the question.",
      });
    }
    await GameState.updateOne(
      { key: "GLOBAL_STATE" },
      {
        $set: {
          crackCodeQuestionId: questionId,
          crackCodeEnded: false,
          crackCodeEndedAt: null,
        },
      },
      { upsert: true }
    );
    return res.json({ message: "Question selected", selectedQuestionId: questionId });
  } catch (error) {
    console.error("CrackCode SELECT QUESTION error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

/*
  POST /admin/crack-code/start
  Body (optional): { questionId }  - falls back to the selected question

  - Admin starts the Crack the Code game
  - Creates one CrackCodeSession per active team, locked to the chosen question
*/
router.post("/start", async (req, res) => {
  try {
    const requestedId = req.body && req.body.questionId;
    if (requestedId && !getQuestionById(requestedId)) {
      return res.status(400).json({ message: "Unknown questionId" });
    }
    const questionId = requestedId || (await getSelectedQuestionId());

    // Fetch ONLY teams that won their Deadlock matches
    const teams = await Team.find({ deadlockResult: 'win' });

    if (teams.length === 0) {
      return res.status(400).json({
        message: "STALEMATE DETECTED: No winning teams eligible for decryption.",
      });
    }
    const alreadyStarted = await CrackCodeSession.findOne();
    if (alreadyStarted) {
      return res.status(400).json({
        message: "Crack the Code game already started",
      });
    }
    await GameState.updateOne(
      { key: "GLOBAL_STATE" },
      {
        $set: {
          crackCodeQuestionId: questionId,
          crackCodeEnded: false,
          crackCodeEndedAt: null,
        },
      },
      { upsert: true }
    );

    // Create CrackCodeSession for each team
    const startedAt = new Date();
    for (const team of teams) {
      await CrackCodeSession.create({
        teamId: team._id,
        questionId,
        attemptsUsed: 0,
        startedAt,
      });
    }

    return res.json({
      message: "Crack the Code game started successfully",
      questionId,
    });
  } catch (error) {
    console.error("CrackCode START error:", error);
    return res.status(500).json({
      message: "Internal server error while starting Crack the Code",
      error: error.message,
    });
  }
});

/*
  GET /admin/crack-code/winner-info
  - Fetches the team details of the first winner
*/
router.get("/winner-info", async (req, res) => {
  try {
    // 1. Fetch the absolute winner (first one)
    const winnerSubmission = await CrackCodeSubmission.findOne({ finalWinner: true })
      .populate("teamId", "name members");

    // 2. Fetch ALL successful breaches, sorted by time
    const allSuccessful = await CrackCodeSubmission.find({ isCorrect: true })
      .sort({ submittedAt: 1 })
      .populate("teamId", "name members");

    return res.json({
      winnerFound: !!winnerSubmission,
      winner: winnerSubmission ? {
        teamName: winnerSubmission.teamId.name,
        members: winnerSubmission.teamId.members,
        submittedAt: winnerSubmission.submittedAt
      } : null,
      allBreaches: allSuccessful.map(sub => ({
        id: sub._id,
        teamId: sub.teamId._id,
        teamName: sub.teamId.name,
        members: sub.teamId.members,
        submittedAt: sub.submittedAt,
        isAbsoluteWinner: sub.finalWinner
      }))
    });
  } catch (error) {
    console.error("Winner info error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/reset", async (req, res) => {
  try {
    // 1. Purge Crack Code Specific Data ONLY
    await CrackCodeSession.deleteMany({});
    await CrackCodeSubmission.deleteMany({});
    await CrackCodeAttempt.deleteMany({});

    // 2. Reset Glitch Availability and Round Ended flag
    await GameState.updateOne(
      { key: 'GLOBAL_STATE' },
      {
        $set: {
          glitchUsed: false,
          glitchActiveUntil: null,
          crackCodeEnded: false,
          crackCodeEndedAt: null,
        }
      },
      { upsert: true }
    );

    return res.json({
      message: "All Crack the Code sessions, submissions, and attempts have been purged. First Blood winner preserved; Glitch skill reset.",
    });
  } catch (error) {
    console.error("CrackCode RESET error:", error);
    return res.status(500).json({
      message: "Internal server error while resetting sessions",
    });
  }
});

/*
  POST /admin/crack-code/end-round
  - Concludes Round 02 officially.
  - Finalizes all active sessions (endedAt = now).
  - Flags GameState with crackCodeEnded = true, crackCodeEndedAt = now.
  - Winner status in CrackCodeSubmission is preserved; all non-winning teams can now download participation certificates.
*/
router.post("/end-round", async (req, res) => {
  try {
    const now = new Date();

    // 1. Mark GameState as ended
    await GameState.updateOne(
      { key: "GLOBAL_STATE" },
      {
        $set: {
          crackCodeEnded: true,
          crackCodeEndedAt: now,
        },
      },
      { upsert: true }
    );

    // 2. Finalize all open sessions so live client editors lock immediately
    await CrackCodeSession.updateMany(
      { endedAt: null },
      { $set: { endedAt: now } }
    );

    // 3. Find if a winner already exists
    const winnerSubmission = await CrackCodeSubmission.findOne({ finalWinner: true })
      .populate("teamId", "name members");

    return res.json({
      success: true,
      message: "Round 02 has officially concluded. Participation certificates are now unlocked for non-winning teams.",
      winner: winnerSubmission ? {
        teamId: winnerSubmission.teamId._id,
        teamName: winnerSubmission.teamId.name,
        members: winnerSubmission.teamId.members,
      } : null,
      endedAt: now,
    });
  } catch (error) {
    console.error("CrackCode END-ROUND error:", error);
    return res.status(500).json({
      message: "Internal server error while ending Round 02",
      error: error.message,
    });
  }
});

/*
  GET /admin/crack-code/teams
  - Lists all teams with Crack the Code eligibility, session state, and submission/winner status
*/
router.get("/teams", async (req, res) => {
  try {
    const [teams, sessions, submissions, state] = await Promise.all([
      Team.find().select("name members deadlockResult currentRound crackCodeManuallyAdded").sort({ name: 1 }).lean(),
      CrackCodeSession.find().lean(),
      CrackCodeSubmission.find().lean(),
      GameState.get(),
    ]);

    const sessionByTeam = new Map(sessions.map((s) => [String(s.teamId), s]));
    const submissionByTeam = new Map(submissions.map((sub) => [String(sub.teamId), sub]));

    const formatted = teams
      .map((team) => {
        const id = String(team._id);
        const session = sessionByTeam.get(id) || null;
        const submission = submissionByTeam.get(id) || null;
        return {
          _id: team._id,
          name: team.name,
          members: team.members || [],
          deadlockResult: team.deadlockResult,
          currentRound: team.currentRound,
          eligible: team.deadlockResult === "win",
          manuallyAdded: !!team.crackCodeManuallyAdded,
          hasSession: !!session,
          sessionActive: !!(session && !session.endedAt),
          sessionEndedAt: session?.endedAt || null,
          hasSubmission: !!submission,
          isWinner: !!submission?.finalWinner,
          isCorrect: !!submission?.isCorrect,
        };
      })
      .sort((a, b) => {
        if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return res.json({
      sessionActive: sessions.length > 0,
      roundEnded: Boolean(state.crackCodeEnded),
      roundEndedAt: state.crackCodeEndedAt || null,
      teams: formatted,
    });
  } catch (error) {
    console.error("CrackCode TEAMS error:", error);
    return res.status(500).json({ message: "Internal server error while fetching teams" });
  }
});

/*
  POST /admin/crack-code/teams/:teamId/eligibility
  Body: { eligible: boolean }
  - Adds or removes a team from Crack the Code eligibility.
  - If a session is already running and eligible=true, creates/reopens a CrackCodeSession for them.
  - If eligible=false, removes their active CrackCodeSession (if any) and marks them eliminated.
*/
router.post("/teams/:teamId/eligibility", async (req, res) => {
  try {
    const { teamId } = req.params;
    const { eligible } = req.body || {};

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (eligible) {
      team.deadlockResult = "win";
      team.currentRound = "crack-the-code";
      team.crackCodeManuallyAdded = true;
      await team.save();

      const anySession = await CrackCodeSession.findOne().select("questionId startedAt");
      if (anySession) {
        const existing = await CrackCodeSession.findOne({ teamId: team._id });
        if (existing) {
          existing.endedAt = null;
          await existing.save();
        } else {
          await CrackCodeSession.create({
            teamId: team._id,
            questionId: anySession.questionId || (await getSelectedQuestionId()),
            attemptsUsed: 0,
            startedAt: anySession.startedAt || new Date(),
          });
        }
      }

      return res.json({
        message: `Team "${team.name}" added to Crack the Code`,
        eligible: true,
      });
    } else {
      team.deadlockResult = "lose";
      team.currentRound = "eliminated";
      team.crackCodeManuallyAdded = false;
      await team.save();

      await CrackCodeSession.deleteMany({ teamId: team._id });

      return res.json({
        message: `Team "${team.name}" removed from Crack the Code`,
        eligible: false,
      });
    }
  } catch (error) {
    console.error("CrackCode ELIGIBILITY error:", error);
    return res.status(500).json({ message: "Internal server error while updating team eligibility" });
  }
});

/*
  POST /admin/crack-code/teams/:teamId/promote-win
  - Promotes a team as the Crack the Code winner (if no winner is already crowned)
*/
router.post("/teams/:teamId/promote-win", async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    const existingWinner = await CrackCodeSubmission.findOne({ finalWinner: true }).populate("teamId", "name");
    if (existingWinner && String(existingWinner.teamId?._id || existingWinner.teamId) !== String(team._id)) {
      return res.status(409).json({
        message: `Winner already crowned (${existingWinner.teamId?.name || "another team"}). Reset systems first to change winner.`,
      });
    }

    team.deadlockResult = "win";
    team.currentRound = "crack-the-code";
    await team.save();

    const anySession = await CrackCodeSession.findOne().select("questionId startedAt");
    const questionId = anySession?.questionId || (await getSelectedQuestionId());
    let session = await CrackCodeSession.findOne({ teamId: team._id });
    if (!session) {
      session = await CrackCodeSession.create({
        teamId: team._id,
        questionId,
        attemptsUsed: 0,
        startedAt: anySession?.startedAt || new Date(),
        endedAt: new Date(),
      });
    } else {
      session.endedAt = new Date();
      await session.save();
    }

    await CrackCodeSubmission.findOneAndUpdate(
      { teamId: team._id, crackCodeSessionId: session._id },
      {
        $set: {
          isCorrect: true,
          finalWinner: true,
          submittedAt: new Date(),
        },
        $setOnInsert: {
          submittedLogic: "// ADMIN_PROMOTED_WIN",
        },
      },
      { upsert: true, new: true }
    );

    return res.json({
      message: `Team "${team.name}" promoted as Crack the Code winner`,
    });
  } catch (error) {
    console.error("CrackCode PROMOTE-WIN error:", error);
    return res.status(500).json({ message: "Internal server error while promoting winner" });
  }
});

/*
  POST /admin/crack-code/teams/:teamId/terminate
  - Terminates an already-playing team's Crack the Code session and removes them from the active round
*/
router.post("/teams/:teamId/terminate", async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    const session = await CrackCodeSession.findOne({ teamId: team._id });
    if (!session) {
      return res.status(404).json({ message: `No active Crack the Code session found for "${team.name}"` });
    }

    session.endedAt = new Date();
    await session.save();

    team.deadlockResult = "lose";
    team.currentRound = "eliminated";
    await team.save();

    return res.json({
      message: `Active session terminated for "${team.name}"`,
    });
  } catch (error) {
    console.error("CrackCode TERMINATE error:", error);
    return res.status(500).json({ message: "Internal server error while terminating team session" });
  }
});

module.exports = router;
