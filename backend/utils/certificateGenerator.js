const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const JSZip = require("jszip");
const Team = require("../model/team.model");

const CACHE_DIR = path.resolve(__dirname, "../cache/certificates");

// Register bundled font
const FONT_PATH = path.resolve(__dirname, "../assets/fonts/pixelon.regular.ttf");
if (fs.existsSync(FONT_PATH)) {
    try {
        GlobalFonts.registerFromPath(FONT_PATH, "Pixelon");
    } catch (err) {
        console.warn("[CERT] Failed to register Pixelon font:", err.message);
    }
}

/**
 * Locate the certificate template file across possible deployment structures
 */
function getTemplatePath() {
    const candidatePaths = [
        path.resolve(__dirname, "../assets/LOC-Certificate.png"),
        path.resolve(__dirname, "../../frontend/public/LOC-Certificate.png"),
        path.resolve(process.cwd(), "assets/LOC-Certificate.png"),
        path.resolve(process.cwd(), "frontend/public/LOC-Certificate.png"),
    ];

    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error("LOC-Certificate.png template not found in assets or public directory");
}

/**
 * Escape regex special characters in a string
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitize strings for safe filenames
 */
function sanitizeFilename(name) {
    return String(name).replace(/[^\w\s\.-]/g, "_").trim();
}

/**
 * Fetch member names dynamically from the LOC (Source) Database
 * Returns array of member names, or falls back to team.members
 */
async function getMembersFromLOCDatabase(team) {
    const sourceUri = process.env.SOURCE_MONGO_URI;
    if (!sourceUri) {
        return team.members || [];
    }

    let sourceConn = null;
    try {
        sourceConn = await mongoose
            .createConnection(sourceUri, { serverSelectionTimeoutMS: 4000 })
            .asPromise();

        // LOC Database detection (default "test" or SOURCE_DB_NAME)
        const dbName = process.env.SOURCE_DB_NAME || "test";
        const sourceDb = sourceConn.useDb(dbName).db;

        const cleanName = (team.name || "").trim();
        const reg = await sourceDb.collection("registrations").findOne({
            $or: [
                { teamName: { $regex: new RegExp(`^${escapeRegex(cleanName)}$`, "i") } },
                { name: { $regex: new RegExp(`^${escapeRegex(cleanName)}$`, "i") } },
            ],
        });

        if (reg) {
            const participantIds = [];
            if (reg.leader) participantIds.push(reg.leader);
            if (Array.isArray(reg.members)) {
                for (const m of reg.members) participantIds.push(m);
            }

            const query = {
                $or: [
                    { _id: { $in: participantIds } },
                    { registration: reg._id },
                ],
            };

            const participants = await sourceDb
                .collection("participants")
                .find(query)
                .toArray();

            const byId = new Map(participants.map((p) => [String(p._id), p]));
            const byReg = participants.filter((p) => p.registration && String(p.registration) === String(reg._id));

            const ordered = [];
            const seen = new Set();
            const addP = (p) => {
                if (!p) return;
                const id = String(p._id);
                if (seen.has(id)) return;
                seen.add(id);
                ordered.push(p);
            };

            if (reg.leader) addP(byId.get(String(reg.leader)));
            if (Array.isArray(reg.members)) {
                for (const mid of reg.members) addP(byId.get(String(mid)));
            }
            byReg.sort((a, b) => (a.role === "leader" ? -1 : 1));
            for (const p of byReg) addP(p);

            const names = ordered
                .map((p) => (p.name || p.email || p.rollNo || "").toString().trim())
                .filter(Boolean);

            if (names.length > 0) {
                // If member names differ from Deadlock DB, sync Deadlock DB non-destructively
                if (JSON.stringify(team.members) !== JSON.stringify(names)) {
                    await Team.updateOne({ _id: team._id }, { $set: { members: names } }).catch(() => {});
                }
                return names;
            }
        }
    } catch (err) {
        console.warn("[CERT] Could not connect/query LOC Database:", err.message);
    } finally {
        if (sourceConn) {
            try {
                await sourceConn.close();
            } catch (_) {}
        }
    }

    return team.members || [];
}

/**
 * Render a single certificate buffer using @napi-rs/canvas
 */
async function renderCertificateBuffer(templateImg, memberName) {
    const w = templateImg.width;
    const h = templateImg.height;
    const scale = w / 1024;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");

    // 1. Draw base template
    ctx.drawImage(templateImg, 0, 0);

    // 2. Clear placeholder "Participant Name _"
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
        Math.round(w * 0.12),
        Math.round(h * 0.485),
        Math.round(w * 0.76),
        Math.round(h * 0.09)
    );

    // 3. Setup font (auto-fit long names within horizontal bounds)
    let fontSize = Math.round(42 * scale);
    const minFontSize = Math.round(24 * scale);
    const gap = Math.round(14 * scale);
    const cursorW = Math.round(20 * scale);
    const cursorH = Math.round(8 * scale);
    const maxTotalW = w * 0.78;

    ctx.font = `${fontSize}px Pixelon`;
    let textW = ctx.measureText(memberName).width;
    while (textW + gap + cursorW > maxTotalW && fontSize > minFontSize) {
        fontSize -= 2;
        ctx.font = `${fontSize}px Pixelon`;
        textW = ctx.measureText(memberName).width;
    }

    const totalW = textW + gap + cursorW;
    const x = (w - totalW) / 2.0;
    const y = h * 0.553; // baseline

    // 4. Draw member name
    ctx.fillStyle = "#000000";
    ctx.fillText(memberName, x, y);

    // 5. Draw orange terminal cursor
    ctx.fillStyle = "#F47E59";
    ctx.fillRect(x + textW + gap, y - Math.round(9 * scale), cursorW, cursorH);

    return canvas.toBuffer("image/png");
}

/**
 * Generates certificates for a given teamId and returns the path to the ZIP archive.
 */
async function generateTeamCertificates(teamId) {
    if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) {
        throw new Error("Invalid teamId provided");
    }

    const team = await Team.findById(teamId);
    if (!team) {
        throw new Error("Team not found in Deadlock database");
    }

    const templatePath = getTemplatePath();

    // 1. Fetch dynamic members from LOC database (or fallback to team.members)
    const members = await getMembersFromLOCDatabase(team);
    if (!members || members.length === 0) {
        throw new Error(`No member names found for team '${team.name}'`);
    }

    // 2. Ensure cache directory exists
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const outputZip = path.join(CACHE_DIR, `${teamId}.zip`);

    // 3. Check if cached zip already exists and is newer than both team data and template
    if (fs.existsSync(outputZip)) {
        const stats = fs.statSync(outputZip);
        const teamUpdated = new Date(team.updatedAt || 0).getTime();
        const templateMtime = fs.statSync(templatePath).mtimeMs;
        if (stats.size > 1000 && stats.mtimeMs > Math.max(teamUpdated, templateMtime)) {
            return {
                filePath: outputZip,
                filename: `${sanitizeFilename(team.name)}_Certificates.zip`,
                teamName: team.name,
                members,
            };
        }
    }

    // 4. Render certificates in pure Node.js and bundle with JSZip
    const templateImg = await loadImage(templatePath);
    const zip = new JSZip();
    const cleanTeam = sanitizeFilename(team.name);

    for (let i = 0; i < members.length; i++) {
        const memberName = String(members[i]).trim();
        const cleanMember = sanitizeFilename(memberName);
        const certPngBuffer = await renderCertificateBuffer(templateImg, memberName);
        const certFilename = `${cleanTeam} - Member ${i + 1} - ${cleanMember}.png`;
        zip.file(certFilename, certPngBuffer);
    }

    const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
    });

    fs.writeFileSync(outputZip, zipBuffer);

    return {
        filePath: outputZip,
        filename: `${cleanTeam}_Certificates.zip`,
        teamName: team.name,
        members,
    };
}

module.exports = {
    generateTeamCertificates,
    getMembersFromLOCDatabase,
    renderCertificateBuffer,
};
