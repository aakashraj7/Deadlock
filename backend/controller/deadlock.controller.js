const DeadlockMatch = require("../model/deadlock.model");
const Team = require("../model/team.model");
const GameState = require("../model/gameState.model");

exports.solveProblem = async (req, res) => {
    try {
        const { matchId, solvingTeamId } = req.body;

        const match = await DeadlockMatch.findById(matchId);

        if (!match || match.status !== "ongoing") {
            return res.status(400).json({
                success: false,
                message: "Match is not ongoing"
            });
        }

        // Identify which team is pulling
        const isTeamA = solvingTeamId.toString() === match.teamA.toString();

        // Alpha pulls negative (-), Omega pulls positive (+)
        match.tugPosition += isTeamA ? -1 : 1;

        // WIN CONDITION
        let winner = null;
        let loser = null;

        if (match.tugPosition <= -match.maxPull) {
            winner = match.teamA;
            loser = match.teamB;
        } else if (match.tugPosition >= match.maxPull) {
            winner = match.teamB;
            loser = match.teamA;
        }

        if (winner) {
            match.status = "finished";
            match.winner = winner;
            match.loser = loser;
            await match.save();

            await Team.findByIdAndUpdate(winner, {
                currentRound: "crack-the-code",
                deadlockResult: "win"
            });

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
                message: `Match won by ${isTeamA ? 'ALPHA' : 'OMEGA'}!`,
                winner,
                status: "finished"
            });
        }

        await match.save();

        res.json({
            success: true,
            message: "Problem solved",
            tugPosition: match.tugPosition
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: "Solve failed",
            error: err.message
        });
    }
};
