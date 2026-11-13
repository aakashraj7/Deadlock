import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import celestiusLogo from '../assets/celestius-logo.png';
import larperOrCoderImg from '../assets/larper-or-coder.png';
import GoatLogo from '../components/Goat/GoatLogo';
import './CrackCodeLobby.css';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

const CrackCodeLobby = ({ onGameReady, onEliminatedChange }) => {
    const navigate = useNavigate();
    const [gameStatusLoading, setGameStatusLoading] = useState(true);
    const [teamStatus, setTeamStatus] = useState(null);
    const [globalStarted, setGlobalStarted] = useState(false);
    const [globalEnded, setGlobalEnded] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    const teamId = localStorage.getItem("teamId");
    const teamName = localStorage.getItem("teamName") || "ALPHA DUO";
    const storedMembers = localStorage.getItem('teamMembers');

    const displayMembers = useMemo(() => {
        if (teamStatus?.members && Array.isArray(teamStatus.members) && teamStatus.members.length > 0) {
            return teamStatus.members;
        }
        try {
            return storedMembers ? JSON.parse(storedMembers) : [];
        } catch {
            return [];
        }
    }, [teamStatus?.members, storedMembers]);

    const displayTeamName = teamStatus?.name || teamName;

    const [isDownloadingCertificates, setIsDownloadingCertificates] = useState(false);
    const [downloadError, setDownloadError] = useState(null);

    // Elapsed clock
    useEffect(() => {
        const timer = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const formatTimer = (totalSec) => {
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const handleDownloadCertificates = async () => {
        if (!teamId || isDownloadingCertificates) return;
        if (!globalEnded) {
            setDownloadError("Participation certificates will become available once Round 02 has officially concluded.");
            return;
        }
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
            const filename = `${(displayTeamName || "Team").replace(/\s+/g, "_")}_Certificates.zip`;
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

    // Polling logic
    useEffect(() => {
        document.title = "Who is the GOAT? · Round 02";
        if (!teamId) {
            setGameStatusLoading(false);
            return;
        }

        const pollEverything = async () => {
            try {
                // 1. Fetch Global Round 02 Status
                const globalRes = await fetch(`${BASE_URL}/api/public/crack-code/global-status?cb=${Date.now()}`);
                if (globalRes.ok) {
                    const data = await globalRes.json();
                    setGlobalStarted(data.started);
                    setGlobalEnded(Boolean(data.ended));
                }

                // 2. Fetch Duo Match Status
                let currentTeamStatus = teamStatus;
                const teamRes = await fetch(`${BASE_URL}/api/public/crack-code/team-status/${teamId}?cb=${Date.now()}`);
                if (teamRes.ok) {
                    const data = await teamRes.json();
                    currentTeamStatus = data;
                    setTeamStatus(data);
                }

                // 3. Check Session Eligibility and Transition
                const isEligible = currentTeamStatus?.deadlockResult === 'win' || currentTeamStatus?.deadlockResult === 'winner';

                if (isEligible) {
                    const sessionRes = await fetch(`${BASE_URL}/api/public/crack-code/session/${teamId}?cb=${Date.now()}`);
                    if (sessionRes.ok) {
                        const data = await sessionRes.json();
                        onGameReady(data);
                    } else if (sessionRes.status === 403 || sessionRes.status === 404) {
                        setGameStatusLoading(false);
                    }
                } else if (currentTeamStatus && currentTeamStatus.deadlockResult !== 'pending') {
                    // Team is either 'lose' or 'eliminated'
                    setGameStatusLoading(false);
                }
            } catch (error) {
                console.error("Crack The Code Lobby Polling Error:", error);
                setGameStatusLoading(false);
            }
        };

        pollEverything();
        const intervalId = setInterval(pollEverything, 2000);
        return () => clearInterval(intervalId);
    }, [teamId, onGameReady]);

    const result = teamStatus?.deadlockResult;
    const isWinner = result === 'win' || result === 'winner';
    const isLoser = result === 'lose' || result === 'eliminated';
    const isOpen = isWinner && globalStarted;

    useEffect(() => {
        if (!onEliminatedChange) return;
        onEliminatedChange(isLoser);
    }, [isLoser, onEliminatedChange]);

    useEffect(() => {
        if (!isLoser) return;
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fsEl) return;
        const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (exitFs) {
            try {
                Promise.resolve(exitFs.call(document)).catch(() => {});
            } catch {
                // Ignore fullscreen exit errors
            }
        }
    }, [isLoser]);

    if (gameStatusLoading) {
        return (
            <div className="goat-page loading-screen">
                <header className="brands">
                    <img src={celestiusLogo} alt="Celestius" className="brand-icon cel-img" />
                    <img src={larperOrCoderImg} alt="LARPER OR CODER" className="brand-icon lar-img" />
                </header>
                <div className="goat-hero-slot">
                    <GoatLogo />
                </div>
                <main className="stage">
                    <div className="num-col">
                        <div className="rd">INIT</div>
                        <div className="num">--</div>
                    </div>
                    <div className="info">
                        <h1>Connecting<br />to arena.</h1>
                        <p className="lede">Calibrating duo clearance & session matrix...</p>
                        <div className="wait">
                            <span>authorizing telemetry<i className="cur" /></span>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    const pageClasses = [
        "goat-page",
        isOpen ? "is-open" : "",
        isLoser ? "is-loser" : "",
        isWinner ? "is-winner" : "is-pending",
    ].filter(Boolean).join(" ");

    return (
        <div className={pageClasses} id="page">
            {/* Header: Clean official brand logos (no redundant duplicate text) */}
            <header className="brands">
                <div className="brand-group cel-group">
                    <img src={celestiusLogo} alt="Celestius" className="brand-icon cel-img" />
                </div>
                <div className="brand-group lar-group">
                    <img src={larperOrCoderImg} alt="LARPER OR CODER" className="brand-icon lar-img" />
                </div>
            </header>

            {/* Round 02 Official Glitch Title Branding (Submerged & Sliced) */}
            <div className="goat-hero-slot">
                <GoatLogo />
            </div>

            {/* Sideways title down left margin */}
            <aside className="side" aria-hidden="true">
                <b>WHO IS THE GOAT?</b>
                <span>
                    {isWinner
                        ? (isOpen ? 'arena session live' : 'qualified duo verified')
                        : isLoser
                            ? 'session finished'
                            : 'awaiting referee audit'}
                </span>
            </aside>

            {/* Main Stage: Balanced two-column layout */}
            <main className="stage">
                <div className="num-col" aria-label={isLoser ? 'Round 01' : 'Round 02'}>
                    <div className="rd" aria-hidden="true">
                        {isLoser ? 'COMPLETED' : 'ROUND'}
                    </div>
                    <div className="num">
                        {isLoser ? '01' : '02'}
                    </div>
                </div>

                <div className="info" aria-live="polite">
                    {isWinner ? (
                        isOpen ? (
                            <>
                                <h1 id="h">Round 02<br />is open.</h1>
                                <p className="lede" id="lede">
                                    Loading your editor now. Decryption environment is live.
                                </p>
                            </>
                        ) : (
                            <>
                                <h1 id="h">Qualified.<br />Round 02 is next.</h1>
                                <p className="lede" id="lede">
                                    Your Round 01 win is confirmed. Stay on this page. The editor opens by itself once the referee launches the round.
                                </p>
                            </>
                        )
                    ) : isLoser ? (
                        <>
                            <h1 id="h">Thank you<br />for competing.</h1>
                            <p className="lede" id="lede">
                                Your duo fought hard in Round 01. Results have been finalized and recorded in the central tournament registry.
                            </p>
                        </>
                    ) : (
                        <>
                            <h1 id="h">Awaiting<br />round audit.</h1>
                            <p className="lede" id="lede">
                                Match results are currently being recorded and verified. Stand by for referee signal.
                            </p>
                        </>
                    )}

                    {/* Dot-leader dossier displaying team name and team members */}
                    <ul className="log" id="log">
                        <li>
                            <span>team</span>
                            <span className="l"></span>
                            <span className="ok">{displayTeamName}</span>
                        </li>
                        <li>
                            <span>operative 01</span>
                            <span className="l"></span>
                            <span className="ok">{displayMembers[0] || 'Operative 01'}</span>
                        </li>
                        <li>
                            <span>operative 02</span>
                            <span className="l"></span>
                            <span className="ok">{displayMembers[1] || 'Operative 02'}</span>
                        </li>
                        <li>
                            <span>round 01</span>
                            <span className="l"></span>
                            <span className={isWinner ? 'ok' : isLoser ? 'warn' : 'lock'}>
                                {isWinner ? 'won' : isLoser ? 'concluded' : 'auditing'}
                            </span>
                        </li>
                        <li>
                            <span>round 02</span>
                            <span className="l"></span>
                            <span className={isOpen ? 'ok' : isWinner ? 'lock' : 'term'}>
                                {isOpen ? 'live' : isWinner ? 'locked' : 'eliminated'}
                            </span>
                        </li>
                    </ul>

                    {/* Status & Actions Area */}
                    {isWinner ? (
                        <div className="wait">
                            <span id="w">
                                {isOpen ? 'launching editor' : 'waiting for referee'}
                                <i className="cur" />
                            </span>
                            {!isOpen && (
                                <span className="time" id="clock">
                                    {formatTimer(elapsedSeconds)}
                                </span>
                            )}
                        </div>
                    ) : isLoser ? (
                        <div className="loser-actions">
                            {globalEnded ? (
                                <button
                                    onClick={handleDownloadCertificates}
                                    disabled={isDownloadingCertificates}
                                    className="cert-btn"
                                    title="Download both team member certificates"
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
                            ) : (
                                <div className="wait" style={{ marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                                    <span>
                                        CERTIFICATES AVAILABLE AFTER ROUND 02 CONCLUDES
                                        <i className="cur" />
                                    </span>
                                </div>
                            )}

                            {downloadError && (
                                <div className="cert-error">{downloadError}</div>
                            )}

                            <button onClick={() => navigate('/')} className="home-link">
                                RETURN TO HOMEPAGE &rarr;
                            </button>
                        </div>
                    ) : (
                        <div className="wait">
                            <span>synchronizing with arena<i className="cur" /></span>
                            <span className="time">{formatTimer(elapsedSeconds)}</span>
                        </div>
                    )}
                </div>
            </main>

            {/* Tournament Progress Route Bar: Only Round 1 and Round 2 (Final) */}
            <footer className="route" aria-label="Tournament progress">
                {isWinner ? (
                    <>
                        <span className="won">R1 won</span>
                        <span className="seg done"></span>
                        <span className={isOpen ? 'ok' : 'on'}>
                            {isOpen ? 'R2 live' : 'R2 waiting'}
                        </span>
                    </>
                ) : isLoser ? (
                    <>
                        <span className="won">R1 played</span>
                        <span className="seg done"></span>
                        <span className="term">R2 concluded</span>
                    </>
                ) : (
                    <>
                        <span className="on">R1 audit</span>
                        <span className="seg"></span>
                        <span>R2 (Final)</span>
                    </>
                )}
            </footer>
        </div>
    );
};

export default CrackCodeLobby;
