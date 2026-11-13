const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const CrackCodeSession = require("../../model/CrackCodeSession");
const CrackCodeSubmission = require("../../model/CrackCodeSubmission");
const Team = require("../../model/team.model");
const CrackCodeAttempt = require("../../model/CrackCodeAttempt");
const GameState = require("../../model/gameState.model");
const {
  DEFAULT_QUESTION_ID,
  getQuestionById,
  toPublicQuestion,
} = require("../../config/crackCodeQuestions");
const { SUPPORTED_LANGUAGES, runCases, hashSubmission } = require("../../utils/crackCodeRunner");

const sessionQuestion = (session) =>
  getQuestionById(session.questionId) || getQuestionById(DEFAULT_QUESTION_ID);

// Returns true when another team's glitch is active and this team must be blocked
const isGlitchBlocked = async (teamId) => {
  const state = await GameState.findOne({ key: "GLOBAL_STATE" });
  return !!(
    state &&
    state.glitchActiveUntil &&
    new Date() < new Date(state.glitchActiveUntil) &&
    state.firstBloodTeamId &&
    state.firstBloodTeamId.toString() !== String(teamId)
  );
};

/*
  GET /crack-code/session/:teamId

  - Allow a team to fetch its CrackCodeSession state
  - Used when player opens the game screen
*/
router.get("/session/:teamId", async (req, res) => {
  try {
    const { teamId } = req.params;

    if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ message: "Valid teamId is required" });
    }

    const team = await Team.findById(teamId).select("deadlockResult");
    if (!team || team.deadlockResult !== 'win') {
      return res.status(403).json({
        message: "ACCESS DENIED: Team has not completed previous mission directives.",
      });
    }

    const session = await CrackCodeSession.findOne({ teamId });
    if (!session) {
      return res.status(404).json({ message: "Crack Code session not started" });
    }

    // Check for existing submission
    const [submission, state] = await Promise.all([
      CrackCodeSubmission.findOne({ teamId, crackCodeSessionId: session._id }),
      GameState.get(),
    ]);

    return res.json({
      sessionId: session._id,
      attemptsUsed: session.attemptsUsed,
      maxAttempts: session.maxAttempts,
      startedAt: session.startedAt,
      endedAt: session.endedAt || null,
      roundEnded: Boolean(state.crackCodeEnded),
      roundEndedAt: state.crackCodeEndedAt || null,
      question: toPublicQuestion(sessionQuestion(session)),
      submission: submission ? {
        isFirst: submission.finalWinner,
        message: submission.finalWinner
          ? "YOU WON\nYOU SUCCESSFULLY CRACKED THE CODE BY REVERSE ENGINEERING"
          : submission.isCorrect
            ? "YOUR EFFORTS NEED TO BE APPRECIATED\nBUT SMALL TIME MANAGEMENT LACKING DECIDED SOMEOTHER AS WINNER. YOU CRACKED THE CODE..."
            : "THANK YOU FOR PARTICIPATION\nTHE GAME HAS ENDED"
      } : (state.crackCodeEnded || session.endedAt) ? {
        isFirst: false,
        message: "ROUND 02 HAS CONCLUDED\nTHANK YOU FOR PARTICIPATING IN CRACK THE CODE"
      } : null
    });
  } catch (error) {
    console.error("Fetch session error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/eligible-teams", async (req, res) => {
  try {
    const count = await Team.countDocuments({
      deadlockResult: 'win'
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Error counting teams" });
  }
});

router.get("/global-status", async (req, res) => {
  try {
    const [sessionExists, state] = await Promise.all([
      CrackCodeSession.findOne().select("_id"),
      GameState.get(),
    ]);
    res.json({
      started: !!sessionExists,
      ended: Boolean(state.crackCodeEnded),
      endedAt: state.crackCodeEndedAt || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching global status" });
  }
});

router.get("/team-status/:teamId", async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ message: "Invalid Team ID" });
    }
    const team = await Team.findById(teamId).select("name members currentRound deadlockResult");
    if (!team) return res.status(404).json({ message: "Team not found" });
    res.json(team);
  } catch (error) {
    res.status(500).json({ message: "Error fetching team status" });
  }
});

/*
  GET /crack-code/certificate/:teamId
  Generates and downloads dynamically rendered participation certificates (ZIP) for the team.
*/
router.get("/certificate/:teamId", async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ message: "Invalid Team ID" });
    }

    // 1. Verify Round 02 has officially concluded
    const state = await GameState.get();
    if (!state.crackCodeEnded) {
      return res.status(403).json({
        message: "Participation certificates will become available once Round 02 has officially concluded.",
      });
    }

    // 2. Winner check: The winning team is stored in the DB as champion and does not receive participation certificates
    const winnerSubmission = await CrackCodeSubmission.findOne({ teamId, finalWinner: true });
    if (winnerSubmission) {
      return res.status(400).json({
        message: "The winning team is registered as the Round 02 champion. Participation certificates are designated for non-winning participants.",
      });
    }

    // 3. Generate & download certificates dynamically for non-winning team
    const { generateTeamCertificates } = require("../../utils/certificateGenerator");
    const { filePath, filename } = await generateTeamCertificates(teamId);

    res.download(filePath, filename, (err) => {
      if (err) {
        console.error("[CERT] Error sending file to client:", err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error downloading certificate archive" });
        }
      }
    });
  } catch (error) {
    console.error("[CERT] Certificate generation error:", error.message);
    res.status(500).json({ message: error.message || "Failed to generate certificates" });
  }
});

/*
  POST /crack-code/run
  Body: { teamId, language, code }

  Runs the code ONLY against the round's visible test cases.
  Hidden test cases are never run or revealed on /run.
  Passing all visible cases enables /submit.
*/
router.post("/run", async (req, res) => {
  try {
    const { teamId, language, code } = req.body || {};

    if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ message: "Valid teamId is required" });
    }
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return res.status(400).json({ message: "Unsupported language" });
    }
    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ message: "Code is required" });
    }

    if (await isGlitchBlocked(teamId)) {
      return res.status(403).json({ success: false, message: "SYSTEM GLITCH ACTIVE - ACCESS DENIED" });
    }

    const session = await CrackCodeSession.findOne({ teamId });
    if (!session) {
      return res.status(404).json({ message: "Session not found for this team" });
    }
    if (session.endedAt) {
      return res.status(403).json({ message: "Session already ended" });
    }

    const question = sessionQuestion(session);

    const results = await runCases({ language, code, question, cases: question.testCases });
    const allVisiblePassed = results.every((r) => r.isCorrect);

    session.attemptsUsed += 1;
    session.validatedCodeHash = allVisiblePassed ? hashSubmission(language, code) : null;
    await session.save();

    const visiblePassedCount = results.filter((r) => r.isCorrect).length;
    await CrackCodeAttempt.create({
      teamId,
      crackCodeSessionId: session._id,
      input: `${question.id} [${language}]`,
      code,
      output: `visible ${visiblePassedCount}/${results.length}`,
      attemptNumber: session.attemptsUsed,
    });

    return res.json({
      results,
      validated: allVisiblePassed,
      attemptsUsed: session.attemptsUsed,
    });
  } catch (error) {
    console.error("CrackCode RUN error:", error.message);
    if (error.code === "EXECUTOR_BUSY") {
      return res.status(503).json({ message: "Code executor is busy. Please run again in a few seconds." });
    }
    return res.status(500).json({ message: "Error executing code", error: error.message });
  }
});

/*
  POST /crack-code/submit
  Body: { teamId, sessionId, submittedLogic, language, autoSubmit }

  Runs ALL test cases (visible + hidden) on the server when submitted manually.
  - Hidden test case inputs/outputs are never sent to the client.
  - If all visible + hidden cases pass, records the submission and claims winner if first.
  - If any hidden case fails, informs the client without ending the session so they can retry.
*/
router.post("/submit", async (req, res) => {
  try {
    const { teamId, sessionId, submittedLogic, language, autoSubmit } = req.body || {};

    if (!teamId || !sessionId || !submittedLogic) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    if (!mongoose.Types.ObjectId.isValid(teamId) || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid teamId or sessionId" });
    }
    if (!autoSubmit && !SUPPORTED_LANGUAGES.includes(language)) {
      return res.status(400).json({ message: "Unsupported language" });
    }

    if (await isGlitchBlocked(teamId)) {
      return res.status(403).json({ success: false, message: "SYSTEM GLITCH ACTIVE - ACCESS DENIED" });
    }

    const session = await CrackCodeSession.findOne({ _id: sessionId, teamId });
    if (!session) {
      return res.status(404).json({ message: "Session not found for this team" });
    }

    const resultMessage = (sub) =>
      sub.finalWinner
        ? "YOU WON\nYOU SUCCESSFULLY CRACKED THE CODE BY REVERSE ENGINEERING"
        : sub.isCorrect
          ? "YOUR EFFORTS NEED TO BE APPRECIATED\nBUT SMALL TIME MANAGEMENT LACKING DECIDED SOMEOTHER AS WINNER. YOU CRACKED THE CODE..."
          : "THANK YOU FOR PARTICIPATION\nTHE GAME HAS ENDED";

    // 1. Check if CURRENT team already has a finalized submission
    const existing = await CrackCodeSubmission.findOne({ teamId, crackCodeSessionId: sessionId });
    if (existing) {
      return res.json({
        success: true,
        passed: existing.isCorrect,
        isFirst: existing.finalWinner,
        message: resultMessage(existing),
      });
    }

    if (session.endedAt) {
      return res.status(403).json({ message: "Session already ended" });
    }

    let isCorrect = false;

    if (!autoSubmit) {
      const question = sessionQuestion(session);
      const visibleCases = question.testCases || [];
      const hiddenCases = question.hiddenTestCases || [];

      // Run visible + hidden cases in a single container execution to cut runner load in half.
      // Hidden results stay strictly on the server and are never returned to the client.
      const allResults = await runCases({
        language,
        code: submittedLogic,
        question,
        cases: [...visibleCases, ...hiddenCases],
      });

      const visibleResults = allResults.slice(0, visibleCases.length);
      const hiddenResults = allResults.slice(visibleCases.length);
      const allVisiblePassed = visibleResults.every((r) => r.isCorrect);
      const allHiddenPassed = hiddenCases.length === 0 || hiddenResults.every((r) => r.isCorrect);

      if (!allVisiblePassed) {
        const visiblePassedCount = visibleResults.filter((r) => r.isCorrect).length;
        session.attemptsUsed += 1;
        session.validatedCodeHash = null;
        await session.save();

        await CrackCodeAttempt.create({
          teamId,
          crackCodeSessionId: session._id,
          input: `${question.id} [${language}] (submit)`,
          code: submittedLogic,
          output: `visible ${visiblePassedCount}/${visibleResults.length}, hidden not verified`,
          attemptNumber: session.attemptsUsed,
        });

        return res.json({
          success: true,
          passed: false,
          failedStage: "visible",
          results: visibleResults,
          message: "Visible testcases failed. Please fix and run again.",
        });
      }

      if (!allHiddenPassed) {
        session.attemptsUsed += 1;
        session.validatedCodeHash = null;
        await session.save();

        await CrackCodeAttempt.create({
          teamId,
          crackCodeSessionId: session._id,
          input: `${question.id} [${language}] (submit)`,
          code: submittedLogic,
          output: `visible ${visibleResults.length}/${visibleResults.length}, hidden failed`,
          attemptNumber: session.attemptsUsed,
        });

        return res.json({
          success: true,
          passed: false,
          failedStage: "hidden",
          results: visibleResults,
          message: "Failed hidden testcase. Handle edge cases and try again.",
        });
      }

      isCorrect = true;
    }

    // 2. Finalize submission (either all cases passed or timer expired autoSubmit).
    //    The unique partial index on { finalWinner: true } guarantees only one winner.
    const base = { teamId, crackCodeSessionId: sessionId, submittedLogic, isCorrect, submittedAt: new Date() };
    let submission;
    try {
      submission = await CrackCodeSubmission.create({ ...base, finalWinner: isCorrect });
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Duplicate key: either this team double-submitted, or another team already won.
      const dup = await CrackCodeSubmission.findOne({ teamId, crackCodeSessionId: sessionId });
      if (dup) {
        return res.json({
          success: true,
          passed: dup.isCorrect,
          isFirst: dup.finalWinner,
          message: resultMessage(dup),
        });
      }
      try {
        submission = await CrackCodeSubmission.create({ ...base, finalWinner: false });
      } catch (err2) {
        if (err2.code !== 11000) throw err2;
        submission = await CrackCodeSubmission.findOne({ teamId, crackCodeSessionId: sessionId });
      }
    }

    const isFirst = submission.finalWinner;
    await CrackCodeSession.findByIdAndUpdate(sessionId, { endedAt: new Date() });

    return res.json({
      success: true,
      passed: submission.isCorrect,
      isFirst,
      message: resultMessage(submission),
    });
  } catch (error) {
    console.error("Submission error:", error);
    if (error.code === "EXECUTOR_BUSY") {
      return res.status(503).json({ message: "Code executor is busy. Please submit again in a few seconds." });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
