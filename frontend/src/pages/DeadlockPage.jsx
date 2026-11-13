import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import DeadlockHeader from '../components/deadlock/DeadlockHeader';
import TugOfWarArena from '../components/deadlock/TugOfWarArena';
import QuestionPanel from '../components/deadlock/QuestionPanel';
import CodePanel from '../components/deadlock/CodePanel';
import SubmissionPanel from '../components/deadlock/SubmissionPanel';
import ResultOverlay from '../components/deadlock/ResultOverlay';
import WinnerBackground from '../components/deadlock/WinnerBackground';
import LoserBackground from '../components/deadlock/LoserBackground';
import ScannerLoader from '../components/Loader/ScannerLoader';
import '../components/deadlock/deadlock.css';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

import useSecurity from '../hooks/useSecurity';

const DeadlockPage = () => {
    const teamName = localStorage.getItem('teamName') || 'UNKNOWN';
    const { security, reportAction } = useSecurity(teamName);

    const context = JSON.parse(localStorage.getItem('deadlockContext') || '{}');

    const matchId = context.matchId;
    const navigate = useNavigate();

    // Game State
    const [match, setMatch] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isDismissed, setIsDismissed] = useState(false);
    const [tugPosition, setTugPosition] = useState(0);
    const [currentQuestion, setCurrentQuestion] = useState(null);

    // User State
    const [teamId, setTeamId] = useState(null);

    // Submission State
    const [language, setLanguage] = useState("python");
    const [codes, setCodes] = useState({
        python: "",
        cpp: "",
        java: ""
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionResult, setSubmissionResult] = useState(null);
    const [isScreenPulse, setIsScreenPulse] = useState(false);
    const lastQuestionIndex = React.useRef(-1);
    const isFetching = React.useRef(false);
    const isSubmittingRef = React.useRef(false);
    const submissionResultRef = React.useRef(null);

    // Sync refs with state
    useEffect(() => {
        isSubmittingRef.current = isSubmitting;
    }, [isSubmitting]);

    useEffect(() => {
        submissionResultRef.current = submissionResult;
    }, [submissionResult]);

    const handleCloseOverlay = useCallback(() => {
        submissionResultRef.current = null;
        setSubmissionResult(null);
    }, []);

    const fetchMatchState = useCallback(async () => {
        if (isFetching.current || isSubmittingRef.current) return;
        isFetching.current = true;
        try {
            const res = await axios.get(`${BASE_URL}/api/public/deadlock/match/${matchId}`);
            // Discard stale poll response if a submission started while this request was in flight
            if (isSubmittingRef.current) return;
            const data = res.data;

            // Detect if question advanced (opponent solved it)
            if (lastQuestionIndex.current !== -1 && data.currentQuestionIndex > lastQuestionIndex.current) {
                // If we aren't currently submitting AND we don't already have a local AC being displayed, show "Too Slow!"
                if (!isSubmittingRef.current && submissionResultRef.current?.verdict !== "AC") {
                    const conflictResult = { verdict: "CONFLICT", error: "Opponent solved it first!" };
                    submissionResultRef.current = conflictResult;
                    setSubmissionResult(conflictResult);
                }
            }
            lastQuestionIndex.current = data.currentQuestionIndex;

            setMatch(prev => {
                if (JSON.stringify(prev) === JSON.stringify(data)) return prev;
                return data;
            });
            setTugPosition(data.tugPosition);
            setCurrentQuestion(prev => {
                if (prev?._id === data.currentQuestion?._id) return prev;
                return data.currentQuestion;
            });

            const storedTeamId = localStorage.getItem('teamId');
            if (storedTeamId) {
                setTeamId(storedTeamId);
                // Sync teamName if missing or update it
                if (data.teamA._id === storedTeamId) {
                    localStorage.setItem('teamName', data.teamA.name);
                } else if (data.teamB._id === storedTeamId) {
                    localStorage.setItem('teamName', data.teamB.name);
                }
            }

            setLoading(false);
        } catch (err) {
            if (err.response && err.response.status === 404) {
                setIsDismissed(true);
            } else {
                setError(err.response?.data?.message || "Failed to load match");
            }
            setLoading(false);
        } finally {
            isFetching.current = false;
        }
    }, [matchId]);

    useEffect(() => {
        if (match?.status === 'finished') return;

        fetchMatchState();
        const interval = setInterval(fetchMatchState, 500);
        return () => clearInterval(interval);
    }, [fetchMatchState, match?.status]);

    useEffect(() => {
        if (!currentQuestion) return;

        // Use templates from the question object (normalized to LF)
        setCodes({
            python: (currentQuestion.templates?.python || "").replace(/\r\n/g, "\n"),
            cpp: (currentQuestion.templates?.cpp || "").replace(/\r\n/g, "\n"),
            java: (currentQuestion.templates?.java || "").replace(/\r\n/g, "\n")
        });
    }, [currentQuestion?._id]);

    const handleCodeSubmit = async () => {
        if (isSubmittingRef.current || match?.status === 'finished' || !currentQuestion?._id) {
            return;
        }
        const activeTeamId = teamId || localStorage.getItem('teamId');
        if (!activeTeamId) {
            alert("No team identified. Please join properly.");
            return;
        }

        isSubmittingRef.current = true;
        setIsSubmitting(true);
        submissionResultRef.current = null;
        setSubmissionResult(null);

        try {
            const payload = {
                matchId,
                teamId: activeTeamId,
                questionId: currentQuestion._id,
                language,
                code: codes[language]
            };

            const res = await axios.post(`${BASE_URL}/api/public/deadlock/submit`, payload);

            if (res.status === 200) {
                const data = res.data;
                if (data.success) {
                    const acResult = { verdict: "AC" };
                    submissionResultRef.current = acResult;
                    setSubmissionResult(acResult);
                    setTugPosition(data.tugPosition);
                    // Slight screen shake / pulse on test pass
                    setIsScreenPulse(true);
                    setTimeout(() => setIsScreenPulse(false), 500);

                    // Update ref immediately to prevent poller race condition
                    lastQuestionIndex.current = data.nextQuestionIndex;

                    if (data.status === 'finished') {
                        setMatch(prev => ({
                            ...prev,
                            status: 'finished',
                            winner: data.winner,
                            loser: data.loser,
                            scoreA: data.scoreA,
                            scoreB: data.scoreB,
                            tugPosition: data.tugPosition
                        }));
                    } else {
                        isSubmittingRef.current = false;
                        fetchMatchState();
                    }
                } else {
                    const failResult = {
                        verdict: data.verdict,
                        error: data.error
                    };
                    submissionResultRef.current = failResult;
                    setSubmissionResult(failResult);
                }
            }
        } catch (err) {
            if (err.response && err.response.status === 409) {
                const conflictResult = { verdict: "CONFLICT", error: "The question has changed!" };
                submissionResultRef.current = conflictResult;
                setSubmissionResult(conflictResult);
                isSubmittingRef.current = false;
                fetchMatchState();
            } else {
                const errResult = { verdict: "ERROR", error: "Submission failed" };
                submissionResultRef.current = errResult;
                setSubmissionResult(errResult);
            }
        } finally {
            isSubmittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    const handleCodeSubmitRef = React.useRef(handleCodeSubmit);
    useEffect(() => {
        handleCodeSubmitRef.current = handleCodeSubmit;
    });

    // Global keyboard shortcut: Ctrl+Enter or Cmd+Enter to submit solution
    useEffect(() => {
        const handleGlobalKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.repeat) {
                e.preventDefault();
                if (!isSubmittingRef.current && match?.status !== 'finished') {
                    handleCodeSubmitRef.current();
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [match?.status]);

    if (loading) {
        return (
            <ScannerLoader
                titleOverride="CALIBRATING ARENA"
                subOverride="> [TUG OF AURA] SYNCING ENGINE & TEST CASES"
            />
        );
    }
    if (error) return <div className="error-screen">{error}</div>;
    if (!match) return null;

    if (isDismissed) {
        return <DismissedView />;
    }

    if (match.status === 'finished') {
        return <ResultView match={match} teamId={teamId} userTeam={localStorage.getItem('team')} />;
    }

    return (
        <div className={`deadlock-container ${isScreenPulse ? 'screen-pulse' : ''}`}>
            {/* Slim Top Navigation */}
            <DeadlockHeader />

            {/* Hero Tug of War: Centered, 2-3x taller, team names anchored at ends, live status in center */}
            <TugOfWarArena
                tugPosition={tugPosition}
                maxPull={match.maxPull || 4}
                teamA={match.teamA}
                teamB={match.teamB}
                userTeam={localStorage.getItem('team')}
                scoreA={match.scoreA}
                scoreB={match.scoreB}
            />

            {/* Main Coding Workspace */}
            <div className="game-lower-section">
                <QuestionPanel
                    question={currentQuestion}
                />

                <div className="editor-section">
                    <CodePanel
                        key={`${currentQuestion?._id || 'init'}_${language}`}
                        code={codes[language]}
                        setCode={(newCode) => setCodes(prev => ({ ...prev, [language]: newCode }))}
                        language={language}
                        setLanguage={setLanguage}
                        isLocked={match.status === 'finished' || isSubmitting}
                        onSubmitShortcut={handleCodeSubmit}
                        security={security}
                    />
                    <SubmissionPanel
                        onSubmit={handleCodeSubmit}
                        isSubmitting={isSubmitting}
                    />
                </div>
            </div>

            <ResultOverlay
                result={submissionResult}
                onClose={handleCloseOverlay}
            />
        </div>
    );
};

const ResultView = ({ match, teamId, userTeam }) => {
    const getTeamId = (team) => team?._id || team;
    const winnerId = getTeamId(match.winner);

    // Check winner against both string ID and team side (A/B)
    const isWinner = (winnerId && teamId && winnerId === teamId) ||
        (userTeam === 'A' && winnerId === getTeamId(match.teamA)) ||
        (userTeam === 'B' && winnerId === getTeamId(match.teamB));

    const teamName = localStorage.getItem('teamName') || (userTeam === 'A' ? "ALPHA" : "OMEGA");

    if (isWinner) {
        return (
            <div className="arena-result-view winner">
                <WinnerBackground />
                <div className="arena-result-card winner">
                    <span className="loc-res-corner tl" aria-hidden="true" />
                    <span className="loc-res-corner tr" aria-hidden="true" />
                    <span className="loc-res-corner bl" aria-hidden="true" />
                    <span className="loc-res-corner br" aria-hidden="true" />

                    <div className="loc-res-divider" aria-hidden="true">
                        <span className="loc-res-bracket">
                            <span className="loc-res-hook left" />
                            <span className="loc-res-dash" />
                            <span className="loc-res-dash" />
                        </span>
                        <span className="loc-res-parallelogram winner">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
                            </svg>
                            <span>ROUND 01 // QUALIFIED</span>
                        </span>
                        <span className="loc-res-bracket">
                            <span className="loc-res-dash" />
                            <span className="loc-res-dash" />
                            <span className="loc-res-hook right" />
                        </span>
                    </div>

                    <div className="loc-res-title-top winner">VICTORY</div>
                    <div className="loc-res-title-sub">
                        <span>MAXIMUM AURA SECURED</span>
                        <span className="loc-res-underscore" aria-hidden="true" />
                    </div>
                    <p className="result-subtitle">
                        PROPS TO DUO <strong className="team-highlight">{teamName}</strong>. YOU COOKED AND SURGED TO ROUND 02.
                    </p>

                    <div className="result-stats-grid">
                        <div className="stat-line">
                            <span className="stat-label">STATUS</span>
                            <span className="stat-val green">DOMINATION SUCCESS</span>
                        </div>
                        <div className="stat-line">
                            <span className="stat-label">ALPHA SCORE</span>
                            <span className="stat-val">{match.scoreA || 0}</span>
                        </div>
                        <div className="stat-line">
                            <span className="stat-label">OMEGA SCORE</span>
                            <span className="stat-val">{match.scoreB || 0}</span>
                        </div>
                    </div>

                    <div className="result-actions">
                        <a href="/crackTheCode" className="arena-action-btn primary">
                            PROCEED TO ROUND 02 // CRACK THE CODE &rarr;
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="arena-result-view loser">
            <LoserBackground />
            <div className="arena-result-card loser">
                <span className="loc-res-corner tl" aria-hidden="true" />
                <span className="loc-res-corner tr" aria-hidden="true" />
                <span className="loc-res-corner bl" aria-hidden="true" />
                <span className="loc-res-corner br" aria-hidden="true" />

                <div className="loc-res-divider" aria-hidden="true">
                    <span className="loc-res-bracket">
                        <span className="loc-res-hook left" />
                        <span className="loc-res-dash" />
                        <span className="loc-res-dash" />
                    </span>
                    <span className="loc-res-parallelogram loser">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <span>ROUND 01 // ELIMINATED</span>
                    </span>
                    <span className="loc-res-bracket">
                        <span className="loc-res-dash" />
                        <span className="loc-res-dash" />
                        <span className="loc-res-hook right" />
                    </span>
                </div>

                <div className="loc-res-title-top loser">DEFEAT</div>
                <div className="loc-res-title-sub">
                    <span>AURA DEPLETED</span>
                    <span className="loc-res-underscore" aria-hidden="true" />
                </div>
                <p className="result-subtitle">
                    GOOD FIGHT, DUO <strong className="team-highlight">{teamName}</strong>. KINETIC BEAM PULLED OFF GRID.
                </p>

                <div className="result-stats-grid">
                    <div className="stat-line">
                        <span className="stat-label">STATUS</span>
                        <span className="stat-val red">AURA DEPLETED</span>
                    </div>
                    <div className="stat-line">
                        <span className="stat-label">FINAL PULL SCORE</span>
                        <span className="stat-val">{userTeam === 'A' ? match.scoreA : match.scoreB}</span>
                    </div>
                </div>

                <div className="result-actions">
                    <a href="/crackTheCode" className="arena-action-btn secondary">
                        EXIT ARENA &rarr;
                    </a>
                </div>
            </div>
        </div>
    );
};

const DismissedView = () => {
    const navigate = useNavigate();
    const [countdown, setCountdown] = useState(5);

    useEffect(() => {
        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    navigate('/deadlock/lobby');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [navigate]);

    return (
        <div className="arena-result-view dismissed">
            <div className="arena-result-card dismissed">
                <div className="warning-icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F5A21F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                </div>
                <div className="result-tag-row">
                    <span className="result-phase-pill warning">SESSION DISMISSED</span>
                </div>
                <h1 className="result-main-title warning">
                    MATCH CONCLUDED BY HOST
                </h1>
                <p className="result-subtitle">
                    ARENA SESSION HAS BEEN TERMINATED BY CENTRAL CONTROL.
                </p>

                <div className="dismissed-status">
                    <div className="status-pulse"></div>
                    <span>Returning to lobby in {countdown}s...</span>
                </div>

                <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${(countdown / 5) * 100}%` }}></div>
                </div>

                <button className="arena-action-btn primary" onClick={() => navigate('/deadlock/lobby')}>
                    RETURN TO LOBBY
                </button>
            </div>
        </div>
    );
};

export default DeadlockPage;
