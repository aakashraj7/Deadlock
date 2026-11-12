const GameState = require("../../model/gameState.model");

/*
----------------------------------------------------
ACTIVATE AWAKENING (FIRST ROUND WINNER SKILL)
POST /api/public/glitch/activate
----------------------------------------------------
*/
exports.activateGlitch = async (req, res) => {
    try {
        const { teamId } = req.body;

        const state = await GameState.findOne({ key: 'GLOBAL_STATE' });

        if (!state || !state.firstBloodTeamId) {
            return res.status(400).json({ success: false, message: "Awakening not yet claimed." });
        }

        if (!teamId || String(state.firstBloodTeamId) !== String(teamId)) {
            return res.status(403).json({ success: false, message: "Only the Awakening holder can activate this." });
        }

        if (state.glitchUsed) {
            return res.status(400).json({ success: false, message: "Awakening skill already used." });
        }

        // Atomic Activation (15 Seconds Duration)
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 15 * 1000);

        const result = await GameState.updateOne(
            { key: 'GLOBAL_STATE', glitchUsed: false },
            {
                $set: {
                    glitchUsed: true,
                    glitchActiveUntil: expiresAt
                }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(400).json({ success: false, message: "Activation failed. Awakening skill already used." });
        }

        res.json({ success: true, message: "AWAKENING INITIATED", expiresAt, remainingTime: 15 });

    } catch (err) {
        console.error("Awakening activation error:", err);
        res.status(500).json({ message: "System error" });
    }
};

/*
----------------------------------------------------
GET AWAKENING STATUS (POLLING)
GET /api/public/glitch/status
----------------------------------------------------
*/
exports.getGlitchStatus = async (req, res) => {
    try {
        const state = await GameState.findOne({ key: 'GLOBAL_STATE' })
            .populate("firstBloodTeamId", "name");

        if (!state) {
            return res.json({ active: false, ownerId: null, ownerName: null, remainingTime: 0, glitchUsed: false });
        }

        const now = new Date();
        const isActive = Boolean(state.glitchActiveUntil && new Date(state.glitchActiveUntil) > now);
        const remainingTime = isActive ? Math.ceil((new Date(state.glitchActiveUntil) - now) / 1000) : 0;
        const ownerId = state.firstBloodTeamId ? String(state.firstBloodTeamId._id || state.firstBloodTeamId) : null;
        const ownerName = state.firstBloodTeamId?.name || null;

        res.json({
            active: isActive,
            ownerId,
            ownerName,
            remainingTime,
            glitchUsed: Boolean(state.glitchUsed)
        });

    } catch (err) {
        console.error("Awakening status error:", err);
        res.status(500).json({ message: "System error" });
    }
};
