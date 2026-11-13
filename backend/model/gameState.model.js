const mongoose = require('mongoose');

const gameStateSchema = new mongoose.Schema({
    // Singleton pattern enforcement
    key: {
        type: String,
        default: 'GLOBAL_STATE',
        unique: true
    },

    // First Blood Mechanic
    firstBloodTeamId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
        default: null
    },

    // Glitch Mechanic
    glitchUsed: {
        type: Boolean,
        default: false
    },
    glitchActiveUntil: {
        type: Date,
        default: null
    },

    // Crack the Code: question chosen by the admin for the next / current round
    crackCodeQuestionId: {
        type: String,
        default: null
    },

    // Crack the Code: Round 02 officially concluded
    crackCodeEnded: {
        type: Boolean,
        default: false
    },
    crackCodeEndedAt: {
        type: Date,
        default: null
    }

}, { timestamps: true });

// Ensure only one document exists
gameStateSchema.static('get', async function () {
    let state = await this.findOne({ key: 'GLOBAL_STATE' });
    if (!state) {
        state = await this.create({ key: 'GLOBAL_STATE' });
    }
    return state;
});

module.exports = mongoose.model('GameState', gameStateSchema);
