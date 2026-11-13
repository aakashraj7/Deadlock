import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import CrackCodeLobby from './CrackCodeLobby';
import GoatLogo from '../components/Goat/GoatLogo';
import celestiusLogo from '../assets/celestius-logo.png';
import larperOrCoderImg from '../assets/larper-or-coder.png';
import './CrackTheCode.css';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;
const LANGUAGE_OPTIONS = [
    { value: 'python', label: 'Python', tag: 'py3' },
    { value: 'cpp', label: 'C++', tag: 'gcc' },
    { value: 'javascript', label: 'JavaScript', tag: 'node' },
    { value: 'java', label: 'Java', tag: 'jdk' },
];
const SUPPORTED_LANGUAGES = LANGUAGE_OPTIONS.map((opt) => opt.value);
const RESULT_REVEAL_DELAY_MS = 250;

const normalizeCode = (val) => (typeof val === 'string' ? val.replace(/\r\n/g, '\n') : '');

const getDraftStorageKey = (teamId, sessionId) =>
    `crackCodeDraft:${teamId || 'anon'}:${sessionId || 'default'}`;

const getStarterStorageKey = (teamId, sessionId) =>
    `crackCodeStarter:${teamId || 'anon'}:${sessionId || 'default'}`;

const getLangStorageKey = (teamId, sessionId) =>
    `crackCodeLang:${teamId || 'anon'}:${sessionId || 'default'}`;

const readStoredCodeMap = (storageKey) => {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        const clean = {};
        for (const lang of SUPPORTED_LANGUAGES) {
            if (typeof parsed[lang] === 'string') {
                clean[lang] = normalizeCode(parsed[lang]);
            }
        }
        return clean;
    } catch {
        return {};
    }
};

const writeStoredCodeMap = (storageKey, codeMapObj) => {
    try {
        const normalized = {};
        for (const key of Object.keys(codeMapObj || {})) {
            normalized[key] = normalizeCode(codeMapObj[key]);
        }
        localStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch {
        // Ignore storage quota errors
    }
};

const readStoredDrafts = (teamId, sessionId) =>
    readStoredCodeMap(getDraftStorageKey(teamId, sessionId));

const writeStoredDrafts = (teamId, sessionId, codeMapObj) =>
    writeStoredCodeMap(getDraftStorageKey(teamId, sessionId), codeMapObj);

const readStoredStarter = (teamId, sessionId) =>
    readStoredCodeMap(getStarterStorageKey(teamId, sessionId));

const writeStoredStarter = (teamId, sessionId, starterObj) =>
    writeStoredCodeMap(getStarterStorageKey(teamId, sessionId), starterObj);

// Question (starter code + visible test cases) is served by the backend with the session.
// Running and grading happen server-side; hidden test cases never reach the browser.

const GameHeader = React.memo(({ teamName, initialTime, isGameStarted, submissionResult, onExpire, glitchStatus, onActivateGlitch }) => {
    const [secondsLeft, setSecondsLeft] = React.useState(initialTime);

    // Sync initialTime if it changes (e.g. on lobby transition)
    React.useEffect(() => {
        setSecondsLeft(initialTime);
    }, [initialTime]);

    React.useEffect(() => {
        if (!isGameStarted || secondsLeft <= 0 || submissionResult) return;

        const timerId = setInterval(() => {
            setSecondsLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timerId);
                    onExpire();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timerId);
    }, [isGameStarted, submissionResult, onExpire]);

    const mins = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
    const secs = (secondsLeft % 60).toString().padStart(2, '0');
    const timerTone = secondsLeft > 1200 ? 'is-calm' : (secondsLeft > 300 ? 'is-warn' : 'is-critical');
    const totalDuration = 30 * 60;
    const progressRatio = Math.max(0, Math.min(1, secondsLeft / totalDuration));
    const ringRadius = 9;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference * (1 - progressRatio);

    const teamId = localStorage.getItem('teamId');
    const isOwner = glitchStatus?.ownerId === teamId;
    const canActivate = isOwner && !glitchStatus?.glitchUsed;

    return (
        <header className="arena-header">
            <div className="arena-header-left">
                <img src={celestiusLogo} alt="Celestius" className="arena-brand-icon cel-img" />
                <span className="arena-team-tag">
                    team <b>{teamName}</b>
                </span>
            </div>

            <div className="arena-header-center">
                <GoatLogo className="goat-arena-logo" />
            </div>

            <div className="arena-header-right">
                {canActivate && (
                    <button
                        className="glitch-activate-btn"
                        onClick={onActivateGlitch}
                    >
                        Use Awakening Skill
                    </button>
                )}
                {glitchStatus?.active && (
                    <div className="arena-attack-notice">
                        AWAKENING ACTIVE
                    </div>
                )}

                <div
                    className={`arena-timer ${timerTone} ${secondsLeft <= 0 || submissionResult ? 'is-paused' : ''}`}
                    aria-label={`Time remaining ${mins}:${secs}`}
                >
                    <svg className="arena-timer-ring" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                        <circle
                            className="arena-timer-ring-track"
                            cx="12"
                            cy="12"
                            r={ringRadius}
                            fill="none"
                            strokeWidth="2.1"
                        />
                        <circle
                            className="arena-timer-ring-progress"
                            cx="12"
                            cy="12"
                            r={ringRadius}
                            fill="none"
                            strokeWidth="2.1"
                            strokeLinecap="round"
                            strokeDasharray={ringCircumference}
                            strokeDashoffset={ringOffset}
                            transform="rotate(-90 12 12)"
                        />
                        <line
                            className="arena-timer-clock-hand-min"
                            x1="12"
                            y1="12"
                            x2="12"
                            y2="8.4"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                        <line
                            className="arena-timer-clock-hand-sec"
                            x1="12"
                            y1="12"
                            x2="12"
                            y2="6.8"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                        />
                        <circle className="arena-timer-clock-pivot" cx="12" cy="12" r="1.2" />
                    </svg>
                    <span className="arena-timer-label">Time</span>
                    <span className="arena-timer-value">
                        <span>{mins}</span>
                        <span className="arena-timer-colon">:</span>
                        <span>{secs}</span>
                    </span>
                </div>

                <img src={larperOrCoderImg} alt="LARPER OR CODER" className="arena-brand-icon lar-img" />
            </div>
        </header>
    );
});

// --- Main Component ---

import useSecurity from '../hooks/useSecurity';
import GlitchOverlay from '../components/crack/GlitchOverlay';
import DismissalOverlay from '../components/crack/DismissalOverlay';

const CrackTheCode = () => {
    const teamName = localStorage.getItem('teamName') || 'UNKNOWN';
    const [isEliminated, setIsEliminated] = useState(false);
    const { security, reportAction } = useSecurity(teamName, { passive: isEliminated });

    const [language, setLanguage] = useState('python');

    const [testCases, setTestCases] = useState([]);
    const [codeMap, setCodeMap] = useState({});
    const [starterCodeMap, setStarterCodeMap] = useState({});
    const [activeTestCase, setActiveTestCase] = useState(0);

    // Timer State
    const [timeLeft, setTimeLeft] = useState(30 * 60); // 30 minutes in seconds
    const [isGameStarted, setIsGameStarted] = useState(false);
    const [introStage, setIntroStage] = useState('idle'); // 'idle' | 'showing' | 'exiting'
    const [sessionId, setSessionId] = useState(null);
    const [submissionResult, setSubmissionResult] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRoundEnded, setIsRoundEnded] = useState(false);
    const [isDownloadingCertificates, setIsDownloadingCertificates] = useState(false);
    const [downloadError, setDownloadError] = useState(null);

    const [isRunning, setIsRunning] = useState(false);
    const [testResults, setTestResults] = useState({});
    const [hiddenTestResult, setHiddenTestResult] = useState(null);
    const [leftTab, setLeftTab] = useState('testcase');
    const [runError, setRunError] = useState(null);
    const [submitError, setSubmitError] = useState(null);
    // { language, code } of the last run that passed every visible + hidden case
    const [lastValidated, setLastValidated] = useState(null);
    const latestCodeRef = React.useRef({});
    const revealTimersRef = React.useRef([]);
    const introTimersRef = React.useRef([]);

    const clearIntroTimers = React.useCallback(() => {
        introTimersRef.current.forEach((id) => clearTimeout(id));
        introTimersRef.current = [];
    }, []);

    useEffect(() => clearIntroTimers, [clearIntroTimers]);

    const clearRevealTimers = React.useCallback(() => {
        revealTimersRef.current.forEach((id) => clearTimeout(id));
        revealTimersRef.current = [];
    }, []);

    useEffect(() => clearRevealTimers, [clearRevealTimers]);

    // Reveal testcase results sequentially (Case 1 immediately, then +250ms per case).
    const revealResultsSequentially = React.useCallback((rawResults, onComplete) => {
        clearRevealTimers();

        const mapped = (rawResults || []).map((r) => {
            const isErr = r.result === "Runtime Error" || r.result === "Error";
            return { ...r, status: isErr ? "error" : "success" };
        });

        if (mapped.length === 0) {
            setTestResults({});
            onComplete();
            return;
        }

        setTestResults({ 0: mapped[0] });

        if (mapped.length === 1) {
            onComplete();
            return;
        }

        mapped.slice(1).forEach((item, offset) => {
            const index = offset + 1;
            const timerId = setTimeout(() => {
                setTestResults((prev) => ({ ...prev, [index]: item }));
                if (index === mapped.length - 1) {
                    revealTimersRef.current = [];
                    onComplete();
                }
            }, index * RESULT_REVEAL_DELAY_MS);
            revealTimersRef.current.push(timerId);
        });
    }, [clearRevealTimers]);

    useEffect(() => {
        if (isGameStarted) {
            document.title = "Who's the GOAT? // Celestius";
        }
    }, [isGameStarted]);

    // Backfill default starter boilerplate if the active session resumed without it (e.g. HMR).
    useEffect(() => {
        if (!isGameStarted || Object.keys(starterCodeMap).length > 0) return;
        const teamId = localStorage.getItem('teamId');
        if (!teamId) return;

        const cached = readStoredStarter(teamId, sessionId);
        if (Object.keys(cached).length > 0) {
            Promise.resolve().then(() => setStarterCodeMap(cached));
            return;
        }

        let cancelled = false;
        fetch(`${BASE_URL}/api/public/crack-code/session/${teamId}?cb=${Date.now()}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled || !data?.question?.starterCode) return;
                writeStoredStarter(teamId, data.sessionId || sessionId, data.question.starterCode);
                setStarterCodeMap(data.question.starterCode);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [isGameStarted, sessionId, starterCodeMap]);

    // DISMISSAL STATE
    const [isDismissed, setIsDismissed] = useState(false);

    // GLITCH STATE
    const [glitchStatus, setGlitchStatus] = useState({
        active: false,
        ownerId: null,
        glitchUsed: false
    });

    // --- GLITCH & STATUS POLLING ---
    useEffect(() => {
        const fetchGlitchStatus = async () => {
            try {
                // 1. Check Global Status
                const globalRes = await fetch(`${BASE_URL}/api/public/crack-code/global-status?cb=${Date.now()}`);
                if (globalRes.ok) {
                    const globalData = await globalRes.json();
                    if (globalData.ended) {
                        setIsRoundEnded(true);
                    }
                    // If game was started but now global session is gone -> ADMIN DISMISSED
                    if (isGameStarted && !globalData.started && !submissionResult) {
                        setIsDismissed(true);
                        // Transition back after 5 seconds
                        setTimeout(() => {
                            window.location.reload(); // Simple way to reset state and return to lobby
                        }, 5000);
                        return; // Stop polling glitch if dismissed
                    }
                }

                // 1b. Check Team-Specific Session (handles single-team Terminate or Promote Win)
                const teamId = localStorage.getItem("teamId");
                if (isGameStarted && teamId && !submissionResult) {
                    const teamSessionRes = await fetch(`${BASE_URL}/api/public/crack-code/session/${teamId}?cb=${Date.now()}`);
                    if (teamSessionRes.status === 403 || teamSessionRes.status === 404) {
                        setIsDismissed(true);
                        setTimeout(() => {
                            window.location.reload();
                        }, 5000);
                        return;
                    }
                    if (teamSessionRes.ok) {
                        const teamSessionData = await teamSessionRes.json();
                        if (teamSessionData.roundEnded) {
                            setIsRoundEnded(true);
                        }
                        if (teamSessionData.submission) {
                            setSubmissionResult(teamSessionData.submission);
                            return;
                        }
                        if (teamSessionData.endedAt) {
                            setIsDismissed(true);
                            setTimeout(() => {
                                window.location.reload();
                            }, 5000);
                            return;
                        }
                    }
                }

                // 2. Check Awakening (Glitch) Status
                const res = await fetch(`${BASE_URL}/api/public/glitch/status?cb=${Date.now()}`);
                if (res.ok) {
                    const data = await res.json();
                    setGlitchStatus({
                        active: data.active,
                        ownerId: data.ownerId,
                        ownerName: data.ownerName || null,
                        glitchUsed: data.glitchUsed,
                        remainingTime: data.remainingTime
                    });
                }
            } catch (err) {
                console.error("Poll error:", err);
            }
        };

        fetchGlitchStatus(); // Initial check
        const interval = setInterval(fetchGlitchStatus, 2000);
        return () => clearInterval(interval);
    }, [isGameStarted, submissionResult]);

    // Active polling for Round 02 official end when on submission/result screen
    useEffect(() => {
        if (!submissionResult) return;
        let isMounted = true;
        const pollPostGame = async () => {
            try {
                const res = await fetch(`${BASE_URL}/api/public/crack-code/global-status?cb=${Date.now()}`);
                if (res.ok && isMounted) {
                    const data = await res.json();
                    setIsRoundEnded(Boolean(data.ended));
                }
            } catch {
                // Ignore polling errors
            }
        };
        pollPostGame();
        const interval = setInterval(pollPostGame, 2000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [submissionResult]);

    const handleDownloadCertificates = async () => {
        const teamId = localStorage.getItem("teamId");
        if (!teamId || isDownloadingCertificates) return;
        try {
            setIsDownloadingCertificates(true);
            setDownloadError(null);

            const res = await fetch(`${BASE_URL}/api/public/crack-code/certificate/${teamId}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || "Failed to download certificates");
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const filename = `${(teamName || "Team").replace(/\s+/g, "_")}_Certificates.zip`;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error("Certificate download error:", err);
            setDownloadError(err.message || "Could not generate certificates. Please try again.");
        } finally {
            setIsDownloadingCertificates(false);
        }
    };

    const handleActivateGlitch = async () => {
        const teamId = localStorage.getItem("teamId");
        if (!teamId) return;

        if (!window.confirm("WARNING: INITIATING AWAKENING WILL DISRUPT ALL OPPONENTS FOR 15 SECONDS. EXECUTE?")) return;

        try {
            const res = await fetch(`${BASE_URL}/api/public/glitch/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teamId })
            });
            const data = await res.json();
            if (data.success) {
                setGlitchStatus((prev) => ({
                    ...prev,
                    active: true,
                    glitchUsed: true,
                    remainingTime: data.remainingTime || 15
                }));
                alert("AWAKENING INITIATED. OPPONENTS LOCKED FOR 15 SECONDS.");
            } else {
                alert("ACTIVATION FAILED: " + data.message);
            }
        } catch (err) {
            console.error("Awakening activation error:", err);
            alert("SYSTEM ERROR");
        }
    };
    // --------------------

    // --- Callback Stability Ref Pattern ---
    // This prevents high-frequency renders (keystrokes) from resetting the timer
    const handleSubmitRef = React.useRef();

    const handleLanguageChange = React.useCallback((next) => {
        const nextLang = typeof next === 'string' ? next : next?.target?.value;
        if (!nextLang) return;
        setLanguage(nextLang);
        try {
            const teamId = localStorage.getItem('teamId');
            localStorage.setItem(getLangStorageKey(teamId, sessionId), nextLang);
        } catch {
            // Ignore storage errors
        }
    }, [sessionId]);

    const handleCodeChange = React.useCallback((value) => {
        latestCodeRef.current[language] = value;
        const teamId = localStorage.getItem('teamId');
        writeStoredDrafts(teamId, sessionId, latestCodeRef.current);
        setCodeMap((prev) => ({
            ...prev,
            [language]: value
        }));
    }, [language, sessionId]);

    const handleCodeImmediate = React.useCallback((lang, value) => {
        latestCodeRef.current[lang] = value;
        const teamId = localStorage.getItem('teamId');
        writeStoredDrafts(teamId, sessionId, latestCodeRef.current);
    }, [sessionId]);

    const handleResetLanguage = React.useCallback((lang, freshCode) => {
        latestCodeRef.current = {
            ...latestCodeRef.current,
            [lang]: freshCode,
        };
        const teamId = localStorage.getItem('teamId');
        writeStoredDrafts(teamId, sessionId, latestCodeRef.current);
        setCodeMap((prev) => ({
            ...prev,
            [lang]: freshCode,
        }));
        setLastValidated((prev) => (prev?.language === lang ? null : prev));
        setSubmitError(null);
    }, [sessionId]);

    const clearSubmitError = React.useCallback(() => setSubmitError(null), []);

    const handleEditorDidMount = React.useCallback((editor, monaco) => {
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
        });

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES2016,
            allowNonTsExtensions: true,
            moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            module: monaco.languages.typescript.ModuleKind.CommonJS,
            noEmit: true,
            lib: ["esnext", "dom"],
            typeRoots: ["node_modules/@types"]
        });

        monaco.languages.typescript.javascriptDefaults.addExtraLib(`
            declare var console: {
                log(...data: any[]): void;
                error(...data: any[]): void;
                warn(...data: any[]): void;
                info(...data: any[]): void;
            };
        `, 'ts:filename/console.d.ts');
    }, []);

    const handleRun = React.useCallback(async () => {
        const teamId = localStorage.getItem("teamId");
        if (!teamId) {
            setRunError("Team ID not found. Please log in again.");
            setLeftTab('result');
            return;
        }

        clearRevealTimers();
        const code = latestCodeRef.current[language] ?? codeMap[language] ?? "";
        setCodeMap((prev) => (prev[language] === code ? prev : { ...prev, [language]: code }));
        setIsRunning(true);
        setLeftTab('result');
        setRunError(null);
        setSubmitError(null);
        setTestResults({});
        setHiddenTestResult(null);

        try {
            const response = await fetch(`${BASE_URL}/api/public/crack-code/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teamId, language, code }),
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                const detail = [data.message, data.error].filter(Boolean).join(": ");
                const errMsg = detail || `Execution failed (HTTP ${response.status})`;
                setRunError(errMsg);
                const failed = {};
                testCases.forEach((_, i) => {
                    failed[i] = { log: errMsg, result: "Error", isCorrect: false, status: "error" };
                });
                setTestResults(failed);
                setLastValidated(null);
                setIsRunning(false);
                return;
            }

            const resultsList = data.results || [];
            revealResultsSequentially(resultsList, () => {
                const firstWrongIndex = resultsList.findIndex((r) => !r.isCorrect);
                if (firstWrongIndex !== -1) {
                    setActiveTestCase(firstWrongIndex);
                }
                setLastValidated(data.validated ? { language, code } : null);
                setIsRunning(false);
            });
        } catch (error) {
            const errMsg = error?.message ? `Network Error: ${error.message}` : "Network error while executing code.";
            setRunError(errMsg);
            const failed = {};
            testCases.forEach((_, i) => {
                failed[i] = { log: errMsg, result: "Error", isCorrect: false, status: "error" };
            });
            setTestResults(failed);
            setLastValidated(null);
            setIsRunning(false);
        }
    }, [language, codeMap, testCases, clearRevealTimers, revealResultsSequentially]);

    const handleSubmit = React.useCallback(async (isAutoSubmit = false) => {
        const teamId = localStorage.getItem("teamId");
        if (!teamId || !sessionId) {
            if (!isAutoSubmit) setSubmitError("Session information missing. Please refresh and try again.");
            return;
        }

        clearRevealTimers();
        setIsRunning(false);
        const code = latestCodeRef.current[language] ?? codeMap[language] ?? "";
        setCodeMap((prev) => (prev[language] === code ? prev : { ...prev, [language]: code }));
        setIsSubmitting(true);
        setSubmitError(null);
        if (!isAutoSubmit) {
            setLeftTab('result');
            setRunError(null);
            setHiddenTestResult(null);
            setTestResults({});
        }

        try {
            const response = await fetch(`${BASE_URL}/api/public/crack-code/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teamId,
                    sessionId: sessionId,
                    submittedLogic: code,
                    language,
                    autoSubmit: isAutoSubmit
                }),
            });

            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                if (data.passed === false && !isAutoSubmit) {
                    const finalizeFailedSubmit = () => {
                        if (Array.isArray(data.results)) {
                            const firstWrongIndex = data.results.findIndex((r) => !r.isCorrect);
                            if (firstWrongIndex !== -1) {
                                setActiveTestCase(firstWrongIndex);
                            }
                        }
                        if (data.failedStage === 'hidden') {
                            setHiddenTestResult("Failed hidden testcase");
                            setRunError(data.message || "Failed hidden testcase. Handle edge cases and try again.");
                        } else {
                            setRunError(data.message || "Visible testcases failed.");
                        }
                        setLastValidated(null);
                        setIsSubmitting(false);
                    };

                    if (Array.isArray(data.results)) {
                        revealResultsSequentially(data.results, finalizeFailedSubmit);
                    } else {
                        finalizeFailedSubmit();
                    }
                    return;
                }

                setSubmissionResult({
                    isFirst: data.isFirst,
                    message: data.message
                });
                setIsSubmitting(false);
            } else {
                const errMsg = [data.message, data.error].filter(Boolean).join(": ") || `Submission failed (HTTP ${response.status})`;
                if (!isAutoSubmit) setSubmitError(errMsg);
                setIsSubmitting(false);
            }
        } catch (error) {
            console.error("Submission error:", error);
            if (!isAutoSubmit) setSubmitError(error?.message ? `Network Error: ${error.message}` : "Network error during submission.");
            setIsSubmitting(false);
        }
    }, [language, codeMap, sessionId, clearRevealTimers, revealResultsSequentially]);

    // Keep the ref updated with the latest handleSubmit closure
    React.useEffect(() => {
        handleSubmitRef.current = handleSubmit;
    }, [handleSubmit]);

    // Fully stable handleExpire - reference NEVER changes
    const handleExpire = React.useCallback(() => {
        if (handleSubmitRef.current) {
            handleSubmitRef.current(true);
        }
    }, []);

    // Server is the source of truth on submit; this only gates the button.
    const isSubmitEnabled = !!lastValidated
        && lastValidated.language === language
        && lastValidated.code === (latestCodeRef.current[language] ?? codeMap[language]);

    if (!isGameStarted) {
        return <CrackCodeLobby
            onEliminatedChange={setIsEliminated}
            onGameReady={(sessionData) => {
                setIsEliminated(false);
            if (sessionData && sessionData.startedAt) {
                const startTime = new Date(sessionData.startedAt).getTime();
                const now = Date.now();
                const elapsedSeconds = Math.floor((now - startTime) / 1000);
                const totalDuration = 30 * 60;
                const remaining = Math.max(0, totalDuration - elapsedSeconds);
                setTimeLeft(remaining);
                setSessionId(sessionData.sessionId);
                if (sessionData.question) {
                    const teamId = localStorage.getItem("teamId");
                    const starter = sessionData.question.starterCode || {};
                    const savedDrafts = readStoredDrafts(teamId, sessionData.sessionId);
                    const mergedCode = { ...starter, ...savedDrafts };
                    latestCodeRef.current = { ...mergedCode };
                    writeStoredStarter(teamId, sessionData.sessionId, starter);
                    setStarterCodeMap(starter);
                    setTestCases(sessionData.question.testCases || []);
                    setCodeMap(mergedCode);

                    try {
                        const savedLang = localStorage.getItem(getLangStorageKey(teamId, sessionData.sessionId));
                        if (savedLang && SUPPORTED_LANGUAGES.includes(savedLang)) {
                            setLanguage(savedLang);
                        }
                    } catch {
                        // Ignore storage errors
                    }
                }
                if (sessionData.roundEnded) {
                    setIsRoundEnded(true);
                }
                if (sessionData.submission) {
                    setSubmissionResult(sessionData.submission);
                } else {
                    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
                    if (!prefersReducedMotion) {
                        clearIntroTimers();
                        setIntroStage('showing');
                        introTimersRef.current.push(
                            setTimeout(() => setIntroStage('exiting'), 1250),
                            setTimeout(() => setIntroStage('idle'), 1700)
                        );
                    }
                }
            }
            setIsGameStarted(true);
        }} />;
    }

    // --- Performance Optimization: Unmount main UI on result ---
    if (submissionResult) {
        const isFirst = Boolean(submissionResult.isFirst);
        const isCracked = !isFirst && (submissionResult.message || "").includes("APPRECIATED");
        const resultToneClass = isFirst ? "is-winner" : isCracked ? "is-cracked" : "is-ended";
        const messageLines = (submissionResult?.message || "").split('\n');
        const headline = isFirst
            ? (<>You won.<br />First to crack it.</>)
            : isCracked
                ? (<>Code cracked.<br />Round complete.</>)
                : (<>Session ended.<br />Time expired.</>);

        return (
            <div className={`goat-result-page ${resultToneClass}`}>
                <header className="brands">
                    <img src={celestiusLogo} alt="Celestius" className="brand-icon cel-img" />
                    <img src={larperOrCoderImg} alt="LARPER OR CODER" className="brand-icon lar-img" />
                </header>

                <div className="goat-hero-slot">
                    <GoatLogo />
                </div>

                <aside className="side" aria-hidden="true">
                    <b>WHO&apos;S THE GOAT?</b>
                    <span>{isFirst ? 'champion verified' : isCracked ? 'solution accepted' : 'session finalized'}</span>
                </aside>

                <main className="stage">
                    <div className="num-col" aria-label="Round 02">
                        <div className="rd" aria-hidden="true">
                            {isFirst ? 'VICTORY' : isCracked ? 'SOLVED' : 'CONCLUDED'}
                        </div>
                        <div className="num">02</div>
                    </div>

                    <div className="info" aria-live="polite">
                        <h1>{headline}</h1>
                        <p className="lede">
                            {messageLines.map((line, index) => (
                                <React.Fragment key={index}>
                                    {line}
                                    {index < messageLines.length - 1 && <br />}
                                </React.Fragment>
                            ))}
                        </p>

                        <ul className="log">
                            <li>
                                <span>team</span>
                                <span className="l"></span>
                                <span className={isFirst ? 'ok' : isCracked ? 'lock' : 'term'}>{teamName}</span>
                            </li>
                            <li>
                                <span>round 02</span>
                                <span className="l"></span>
                                <span className={isFirst ? 'ok' : isCracked ? 'lock' : 'term'}>
                                    {isFirst ? 'winner' : isCracked ? 'cracked' : 'ended'}
                                </span>
                            </li>
                            <li>
                                <span>submission</span>
                                <span className="l"></span>
                                <span className={isFirst ? 'ok' : 'lock'}>recorded</span>
                            </li>
                        </ul>

                        {isFirst ? (
                            <div className="wait">
                                <span>
                                    CHAMPION VERIFIED · TOURNAMENT RECORD SECURED
                                    <i className="cur" />
                                </span>
                            </div>
                        ) : isRoundEnded ? (
                            <div className="loser-actions" style={{ marginTop: '1.25rem' }}>
                                <button
                                    onClick={handleDownloadCertificates}
                                    disabled={isDownloadingCertificates}
                                    className="cert-btn"
                                    title="Download both team member participation certificates"
                                >
                                    {isDownloadingCertificates ? (
                                        <>
                                            <i className="cur" />
                                            <span>GENERATING CERTIFICATES...</span>
                                        </>
                                    ) : (
                                        <>
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                <polyline points="7 10 12 15 17 10" />
                                                <line x1="12" y1="15" x2="12" y2="3" />
                                            </svg>
                                            <span>DOWNLOAD PARTICIPATION CERTIFICATES</span>
                                        </>
                                    )}
                                </button>
                                {downloadError && <div className="cert-error">{downloadError}</div>}
                            </div>
                        ) : (
                            <div className="wait">
                                <span>
                                    session locked · certificates available after Round 02 ends
                                    <i className="cur" />
                                </span>
                            </div>
                        )}
                    </div>
                </main>

                <footer className="route" aria-label="Tournament progress">
                    <span className="won">R1 won</span>
                    <span className="seg done"></span>
                    <span className={isFirst ? 'ok' : isCracked ? 'lock' : 'term'}>
                        {isFirst ? 'R2 champion' : isCracked ? 'R2 cracked' : 'R2 ended'}
                    </span>
                </footer>
            </div>
        );
    }

    const teamId = localStorage.getItem('teamId');
    const isVictim = glitchStatus?.active && glitchStatus?.ownerId !== teamId;

    return (
        <div className={`crack-page ${introStage === 'exiting' ? 'is-entering' : ''}`}>
            {introStage !== 'idle' && (
                <div
                    className={`arena-intro-overlay ${introStage === 'exiting' ? 'is-exiting' : ''}`}
                    aria-hidden="true"
                >
                    <div className="arena-intro-card">
                        <div className="arena-intro-logo">
                            <GoatLogo />
                        </div>
                        <div className="arena-intro-eyebrow">ROUND 02 · LIVE</div>
                        <div className="arena-intro-bar">
                            <span className="arena-intro-bar-fill" />
                        </div>
                    </div>
                </div>
            )}

            {isDismissed && <DismissalOverlay />}

            {isVictim && !isDismissed && (
                <GlitchOverlay
                    ownerName={glitchStatus?.ownerName || (glitchStatus?.ownerId ? "RIVAL TEAM" : "UNKNOWN")}
                    remaining={glitchStatus?.remainingTime}
                />
            )}

            <GameHeader
                teamName={teamName}
                initialTime={timeLeft}
                isGameStarted={isGameStarted}
                submissionResult={submissionResult}
                onExpire={handleExpire}
                glitchStatus={glitchStatus}
                onActivateGlitch={handleActivateGlitch}
            />

            <div className="crack-container">
                <LeftPanel
                    testCases={testCases}
                    activeTestCase={activeTestCase}
                    setActiveTestCase={setActiveTestCase}
                    testResults={testResults}
                    hiddenTestResult={hiddenTestResult}
                    isRunning={isRunning}
                    isSubmitting={isSubmitting}
                    leftTab={leftTab}
                    setLeftTab={setLeftTab}
                    runError={runError}
                />

                <RightPanel
                    language={language}
                    code={codeMap[language] || ""}
                    starterCode={starterCodeMap[language] ?? ""}
                    isRunning={isRunning}
                    isSubmitting={isSubmitting}
                    isSubmitEnabled={isSubmitEnabled}
                    submitError={submitError}
                    clearSubmitError={clearSubmitError}
                    handleLanguageChange={handleLanguageChange}
                    handleRun={handleRun}
                    handleSubmit={handleSubmit}
                    handleCodeChange={handleCodeChange}
                    handleCodeImmediate={handleCodeImmediate}
                    handleResetLanguage={handleResetLanguage}
                    handleEditorDidMount={handleEditorDidMount}
                    security={security}
                />
            </div>

            <footer className="arena-route" aria-label="Tournament progress">
                <span className="won">R1 won</span>
                <span className="seg done"></span>
                <span className="live">R2 live</span>
            </footer>
        </div>
    );
};

// --- Memoized Panel Components ---

const CaseStatusIcon = ({ isCorrect }) => (
    <span className={`tc-status-icon ${isCorrect ? 'pass' : 'fail'}`} aria-hidden="true">
        {isCorrect ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
        )}
    </span>
);

const LeftPanel = React.memo(({
    testCases,
    activeTestCase,
    setActiveTestCase,
    testResults,
    hiddenTestResult,
    isRunning,
    isSubmitting,
    leftTab,
    setLeftTab,
    runError
}) => {
    const isBusy = isRunning || isSubmitting;
    const activeResult = testResults[activeTestCase];
    const hasResults = Object.keys(testResults).length > 0;
    const allVisiblePassed = hasResults && testCases.every((_, i) => testResults[i]?.isCorrect);

    const isCaseError = Boolean(
        activeResult && (
            activeResult.status === 'error' ||
            activeResult.result === 'Runtime Error' ||
            activeResult.result === 'Error'
        )
    );

    const getVerdictInfo = () => {
        if (hiddenTestResult && hiddenTestResult.toLowerCase().includes('failed')) {
            return { label: 'Failed Hidden Testcase', cls: 'error' };
        }
        if (runError) return { label: 'Execution Error', cls: 'error' };
        if (activeResult) {
            if (activeResult.result === 'Runtime Error') return { label: 'Runtime Error', cls: 'error' };
            if (activeResult.status === 'error' || activeResult.result === 'Error') return { label: 'Compile / Execution Error', cls: 'error' };
            if (!activeResult.isCorrect) return { label: 'Wrong Answer', cls: 'error' };
            if (allVisiblePassed) return { label: 'Accepted', cls: 'accepted' };
            return { label: 'Wrong Answer', cls: 'error' };
        }
        return null;
    };

    const verdict = getVerdictInfo();

    const passedCount = hasResults ? testCases.filter((_, i) => testResults[i]?.isCorrect).length : 0;

    return (
        <div className="panel left-panel">
            <div className="lc-panel-tabs" role="tablist">
                <div className="lc-panel-tab-group">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={leftTab === 'testcase'}
                        className={`lc-mode-tab ${leftTab === 'testcase' ? 'active' : ''}`}
                        onClick={() => setLeftTab('testcase')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="4 17 10 11 4 5" />
                            <line x1="12" y1="19" x2="20" y2="19" />
                        </svg>
                        <span>testcase</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={leftTab === 'result'}
                        className={`lc-mode-tab ${leftTab === 'result' ? 'active' : ''}`}
                        onClick={() => setLeftTab('result')}
                    >
                        {isBusy ? (
                            <span className="lc-spinner sm" aria-hidden="true" />
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="9 11 12 14 22 4" />
                                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                            </svg>
                        )}
                        <span>test_result</span>
                    </button>
                </div>
                <span className="lc-panel-rd">ROUND 02</span>
            </div>

            <div className="lc-left-body">
                {leftTab === 'testcase' && (
                    <div className="lc-prompt-hint">
                        <span className="lc-prompt-icon" aria-hidden="true">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M9.5 9.5a2.5 2.5 0 0 1 5 .8c0 1.7-2.5 2-2.5 3.7" />
                                <circle cx="12" cy="17.5" r="0.6" fill="currentColor" />
                            </svg>
                        </span>
                        <p className="lc-prompt-copy">
                            Deduce the hidden logic from the sample inputs and outputs, then implement <code>decodeLogic</code>.
                        </p>
                    </div>
                )}

                {leftTab === 'result' && (
                    <div className="lc-verdict-row">
                        <div className="lc-verdict-main">
                            {isBusy ? (
                                <span className="lc-verdict-text running">
                                    <span className="lc-spinner" aria-hidden="true" />
                                    {isSubmitting
                                        ? 'Submitting and running all testcases (including hidden)...'
                                        : 'Running testcases...'}
                                </span>
                            ) : verdict ? (
                                <>
                                    <span className={`lc-verdict-text ${verdict.cls}`}>{verdict.label}</span>
                                    {hasResults && (!runError || hiddenTestResult) && (
                                        <span className="lc-pass-count">
                                            {passedCount}/{testCases.length} visible passed
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="lc-empty-state">Run your code to see test results.</span>
                            )}
                        </div>
                    </div>
                )}

                <div className="testcase-tabs" role="tablist" aria-label="Visible testcases">
                    {testCases.map((_, index) => {
                        const result = testResults[index];
                        const hasCaseResult = result?.isCorrect !== undefined;
                        const statusClass = hasCaseResult
                            ? (result.isCorrect ? 'is-pass' : 'is-fail')
                            : '';
                        return (
                            <button
                                key={index}
                                type="button"
                                role="tab"
                                aria-selected={activeTestCase === index}
                                className={`tab-btn ${activeTestCase === index ? 'active' : ''} ${statusClass}`}
                                onClick={() => setActiveTestCase(index)}
                            >
                                {hasCaseResult ? (
                                    <CaseStatusIcon isCorrect={result.isCorrect} />
                                ) : (
                                    isBusy && <span className="lc-spinner sm" aria-label={`Running Case ${index + 1}`} />
                                )}
                                <span>Case {index + 1}</span>
                            </button>
                        );
                    })}
                </div>

                {leftTab === 'testcase' ? (
                    <div key={`tc-${activeTestCase}`} className="testcase-content">
                        <div className="io-group">
                            <span className="label">Input</span>
                            <pre className="io-box">{testCases[activeTestCase]?.input || ""}</pre>
                        </div>
                        <div className="io-group">
                            <span className="label">Expected Output</span>
                            <pre className="io-box">{testCases[activeTestCase]?.output ?? ""}</pre>
                        </div>
                    </div>
                ) : (
                    <div key={`res-${activeTestCase}`} className="testcase-content">
                        {!isBusy && runError && (
                            <div className="io-group">
                                <span className="label">Error Message</span>
                                <pre className="lc-error-box">{runError}</pre>
                            </div>
                        )}

                        {activeResult && !runError && isCaseError && (
                            <div className="io-group">
                                <span className="label">Error Details</span>
                                <pre className="lc-error-box">
                                    {activeResult?.log || activeResult?.result || "Execution failed."}
                                </pre>
                            </div>
                        )}

                        <div className="io-group">
                            <span className="label">Input</span>
                            <pre className="io-box">{testCases[activeTestCase]?.input || ""}</pre>
                        </div>

                        {activeResult && !isCaseError && activeResult?.log && (
                            <div className="io-group">
                                <span className="label">Stdout</span>
                                <pre className="io-box">{activeResult.log}</pre>
                            </div>
                        )}

                        {activeResult && !isCaseError && (
                            <div className="io-group">
                                <span className="label">Output</span>
                                <pre className={`io-box ${activeResult.isCorrect ? 'output-pass' : 'output-fail'}`}>
                                    {activeResult.result || ""}
                                </pre>
                            </div>
                        )}

                        <div className="io-group">
                            <span className="label">Expected</span>
                            <pre className="io-box">{testCases[activeTestCase]?.output ?? ""}</pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

const LanguageDropdown = React.memo(({ value, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(() =>
        Math.max(0, LANGUAGE_OPTIONS.findIndex((opt) => opt.value === value))
    );
    const containerRef = React.useRef(null);
    const triggerRef = React.useRef(null);

    const selectedOption = LANGUAGE_OPTIONS.find((opt) => opt.value === value) || LANGUAGE_OPTIONS[0];

    useEffect(() => {
        if (!isOpen) return;
        const handleOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [isOpen]);

    const toggleMenu = () => {
        setIsOpen((prev) => {
            const next = !prev;
            if (next) {
                const currentIdx = LANGUAGE_OPTIONS.findIndex((opt) => opt.value === value);
                setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
            }
            return next;
        });
    };

    const selectOption = (nextValue) => {
        onChange(nextValue);
        setIsOpen(false);
        triggerRef.current?.focus();
    };

    const handleKeyDown = (event) => {
        if (!isOpen) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                const currentIdx = LANGUAGE_OPTIONS.findIndex((opt) => opt.value === value);
                setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
                setIsOpen(true);
            }
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setIsOpen(false);
            triggerRef.current?.focus();
        } else if (event.key === 'Tab') {
            setIsOpen(false);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlightedIndex((prev) => (prev + 1) % LANGUAGE_OPTIONS.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlightedIndex((prev) => (prev - 1 + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const picked = LANGUAGE_OPTIONS[highlightedIndex];
            if (picked) selectOption(picked.value);
        }
    };

    return (
        <div
            ref={containerRef}
            className={`lang-selector ${isOpen ? 'is-open' : ''}`}
            onKeyDown={handleKeyDown}
        >
            <button
                ref={triggerRef}
                type="button"
                className="lang-trigger"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-label="Select programming language"
                onClick={toggleMenu}
            >
                <svg className="lang-trigger-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                </svg>
                <span className="lang-trigger-label">{selectedOption.label}</span>
                <svg className="lang-trigger-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {isOpen && (
                <div className="lang-menu" role="listbox" aria-label="Programming languages">
                    {LANGUAGE_OPTIONS.map((opt, index) => {
                        const isSelected = opt.value === value;
                        const isHighlighted = index === highlightedIndex;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className={`lang-option ${isSelected ? 'is-selected' : ''} ${isHighlighted ? 'is-highlighted' : ''}`}
                                onMouseEnter={() => setHighlightedIndex(index)}
                                onClick={() => selectOption(opt.value)}
                            >
                                <span className="lang-option-main">
                                    <span className="lang-option-dot" aria-hidden="true" />
                                    <span className="lang-option-label">{opt.label}</span>
                                </span>
                                <span className="lang-option-meta">
                                    <span className="lang-option-tag">{opt.tag}</span>
                                    {isSelected && (
                                        <svg className="lang-option-check" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

const ResetConfirmModal = React.memo(({ languageLabel, otherLanguagesText, isClosing, onCancel, onConfirm }) => {
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);

    return (
        <div
            className={`reset-modal-backdrop ${isClosing ? 'is-closing' : ''}`}
            role="presentation"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div
                className={`reset-modal ${isClosing ? 'is-closing' : ''}`}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="reset-modal-title"
                aria-describedby="reset-modal-desc"
            >
                <div className="reset-modal-badge" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                        <path d="M3 3v5h5" />
                    </svg>
                </div>

                <h2 id="reset-modal-title" className="reset-modal-title">
                    Reset {languageLabel} code?
                </h2>

                <p id="reset-modal-desc" className="reset-modal-desc">
                    This will restore the default <strong>{languageLabel}</strong> boilerplate code and discard your current {languageLabel} changes. Your code in {otherLanguagesText} will remain untouched.
                </p>

                <div className="reset-modal-actions">
                    <button
                        type="button"
                        className="reset-modal-btn cancel"
                        autoFocus
                        onClick={onCancel}
                    >
                        Keep Code
                    </button>
                    <button
                        type="button"
                        className="reset-modal-btn confirm"
                        onClick={onConfirm}
                    >
                        Reset {languageLabel}
                    </button>
                </div>
            </div>
        </div>
    );
});

const RightPanel = React.memo(({
    language, code, starterCode, isRunning, isSubmitting, isSubmitEnabled,
    submitError, clearSubmitError,
    handleLanguageChange, handleRun,
    handleSubmit, handleCodeChange, handleCodeImmediate, handleResetLanguage, handleEditorDidMount,
    security
}) => {
    const editorRef = React.useRef(null);
    const codeSyncTimerRef = React.useRef(null);
    const [resetModalOpen, setResetModalOpen] = useState(false);
    const [resetModalClosing, setResetModalClosing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const modalTimerRef = React.useRef(null);
    const resetAnimTimerRef = React.useRef(null);

    useEffect(() => () => {
        if (modalTimerRef.current) clearTimeout(modalTimerRef.current);
        if (resetAnimTimerRef.current) clearTimeout(resetAnimTimerRef.current);
        if (codeSyncTimerRef.current) clearTimeout(codeSyncTimerRef.current);
    }, []);

    const onMountInternal = React.useCallback((editor, monaco) => {
        editorRef.current = editor;
        if (handleEditorDidMount) {
            handleEditorDidMount(editor, monaco);
        }
    }, [handleEditorDidMount]);

    // Handle high-frequency changes from Monaco typing without resetting the editor model
    const onInternalChange = React.useCallback((value) => {
        const next = normalizeCode(value);
        handleCodeImmediate(language, next);

        // Debounce background state sync
        if (codeSyncTimerRef.current) clearTimeout(codeSyncTimerRef.current);
        codeSyncTimerRef.current = setTimeout(() => {
            handleCodeChange(next);
        }, 800);
    }, [handleCodeImmediate, handleCodeChange, language]);

    // Safely sync code ONLY when it genuinely changes externally (language switch / reset / external load)
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const normalizedIncoming = normalizeCode(code);
        const currentModelVal = normalizeCode(editor.getValue());

        // If editor already holds this text (e.g. from typing), NEVER touch the model to avoid cursor jumping
        if (currentModelVal === normalizedIncoming) return;

        const pos = editor.getPosition();
        const viewState = editor.saveViewState();
        editor.setValue(normalizedIncoming);
        if (viewState) {
            editor.restoreViewState(viewState);
        } else if (pos) {
            editor.setPosition(pos);
        }
    }, [code]);

    const openResetModal = React.useCallback(() => {
        if (modalTimerRef.current) clearTimeout(modalTimerRef.current);
        setResetModalClosing(false);
        setResetModalOpen(true);
    }, []);

    const closeResetModal = React.useCallback(() => {
        if (!resetModalOpen || resetModalClosing) return;
        setResetModalClosing(true);
        if (modalTimerRef.current) clearTimeout(modalTimerRef.current);
        modalTimerRef.current = setTimeout(() => {
            setResetModalOpen(false);
            setResetModalClosing(false);
            modalTimerRef.current = null;
        }, 180);
    }, [resetModalOpen, resetModalClosing]);

    const hasStarterCode = typeof starterCode === 'string' && starterCode.length > 0;

    const confirmResetCode = React.useCallback(() => {
        if (!hasStarterCode) {
            closeResetModal();
            return;
        }
        closeResetModal();
        const normalizedStarter = normalizeCode(starterCode);

        if (editorRef.current) {
            editorRef.current.setValue(normalizedStarter);
            editorRef.current.setPosition({ lineNumber: 1, column: 1 });
            editorRef.current.focus();
        }
        handleResetLanguage(language, normalizedStarter);

        setIsResetting(false);
        if (resetAnimTimerRef.current) clearTimeout(resetAnimTimerRef.current);
        requestAnimationFrame(() => {
            setIsResetting(true);
            resetAnimTimerRef.current = setTimeout(() => {
                setIsResetting(false);
                resetAnimTimerRef.current = null;
            }, 560);
        });
    }, [hasStarterCode, closeResetModal, starterCode, handleResetLanguage, language]);

    const selectedLanguageOption = LANGUAGE_OPTIONS.find((opt) => opt.value === language) || LANGUAGE_OPTIONS[0];
    const otherLanguageLabels = LANGUAGE_OPTIONS
        .filter((opt) => opt.value !== language)
        .map((opt) => opt.label);
    const otherLanguagesText = otherLanguageLabels.length > 1
        ? `${otherLanguageLabels.slice(0, -1).join(', ')}, and ${otherLanguageLabels[otherLanguageLabels.length - 1]}`
        : (otherLanguageLabels[0] || 'other languages');

    const editorOptions = React.useMemo(() => ({
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        quickSuggestions: { other: true, comments: true, strings: true },
        parameterHints: { enabled: true },
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: "on",
        tabCompletion: "on",
        contextmenu: !security?.disableCopyPaste && !security?.disableTextSelection && !security?.blockDevTools && !security?.blockAiAssistant,
        copySelection: !security?.disableCopyPaste,
        links: false,
        dragAndDrop: false,
        selectionClipboard: false
    }), [security?.disableCopyPaste, security?.disableTextSelection, security?.blockDevTools, security?.blockAiAssistant]);

    return (
        <div className="panel right-panel">
            <div className="editor-header">
                <LanguageDropdown value={language} onChange={handleLanguageChange} />
                <div className="actions">
                    <button
                        type="button"
                        className={`btn reset-btn ${isResetting ? 'is-spinning' : ''}`}
                        onClick={openResetModal}
                        disabled={isRunning || isSubmitting || !hasStarterCode}
                        title={`Restore default ${selectedLanguageOption.label} boilerplate code`}
                    >
                        <svg className="reset-btn-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                            <path d="M3 3v5h5" />
                        </svg>
                        <span>Reset</span>
                    </button>
                    <button className="btn run-btn" onClick={handleRun} disabled={isRunning || isSubmitting}>
                        {isRunning ? (
                            <span className="lc-spinner sm" aria-hidden="true" />
                        ) : (
                            <svg className="run-btn-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                        )}
                        <span>{isRunning ? 'Running' : 'Run'}</span>
                    </button>
                    <button
                        className="btn submit-btn"
                        onClick={() => handleSubmit()}
                        disabled={!isSubmitEnabled || isRunning || isSubmitting}
                        title={!isSubmitEnabled ? "Pass all visible testcases via Run to enable Submit" : "Submit and run all testcases including hidden"}
                    >
                        {isSubmitting ? (
                            <span className="lc-spinner sm" aria-hidden="true" />
                        ) : (
                            <svg className="submit-btn-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M22 2L11 13" />
                                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                            </svg>
                        )}
                        <span>{isSubmitting ? "Submitting..." : "Submit"}</span>
                    </button>
                </div>
            </div>

            {submitError && (
                <div className="lc-inline-banner-error" role="alert">
                    <span>{submitError}</span>
                    <button type="button" className="lc-inline-banner-close" onClick={clearSubmitError}>
                        Dismiss
                    </button>
                </div>
            )}

            <div className={`monaco-wrapper ${isResetting ? 'is-resetting' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
                <Editor
                    key={language}
                    height="100%"
                    language={language === 'cpp' ? 'cpp' : language}
                    theme="vs-dark"
                    defaultValue={normalizeCode(code)}
                    onChange={onInternalChange}
                    onMount={onMountInternal}
                    options={editorOptions}
                />
            </div>

            {resetModalOpen && (
                <ResetConfirmModal
                    languageLabel={selectedLanguageOption.label}
                    otherLanguagesText={otherLanguagesText}
                    isClosing={resetModalClosing}
                    onCancel={closeResetModal}
                    onConfirm={confirmResetCode}
                />
            )}
        </div>
    );
});

export default CrackTheCode;
