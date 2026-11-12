import React, { useState } from 'react';
import './CrackCodeAdmin.css';
import { adminFetch } from '../api/adminAuth';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;
const CrackCodeAdmin = () => {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
    const [eligibleCount, setEligibleCount] = useState(0);
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [winnerInfo, setWinnerInfo] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [selectedQuestionId, setSelectedQuestionId] = useState(null);
    const [activeQuestionId, setActiveQuestionId] = useState(null);
    const [questionError, setQuestionError] = useState(null);
    const [questionsUnavailable, setQuestionsUnavailable] = useState(false);
    const [teams, setTeams] = useState([]);
    const [teamSearch, setTeamSearch] = useState('');
    const [teamActionId, setTeamActionId] = useState(null);

    const fetchStatus = React.useCallback(async () => {
        try {
            // Check eligible teams
            const eligibleRes = await fetch(`${BASE_URL}/api/public/crack-code/eligible-teams`);
            const eligibleData = await eligibleRes.json();
            setEligibleCount(eligibleData.count || 0);

            // Check global session status
            const statusRes = await fetch(`${BASE_URL}/api/public/crack-code/global-status`);
            const statusData = await statusRes.json();
            setIsSessionActive(statusData.started);

            // Question bank + current selection
            const questionsRes = await adminFetch(`${BASE_URL}/api/admin/crack-code/questions`);
            if (questionsRes.ok) {
                const questionsData = await questionsRes.json();
                setQuestions(questionsData.questions || []);
                setSelectedQuestionId(questionsData.selectedQuestionId);
                setActiveQuestionId(questionsData.activeQuestionId);
                setQuestionsUnavailable(false);
            } else {
                setQuestionsUnavailable(true);
            }

            // Team roster + eligibility + active session state
            const teamsRes = await adminFetch(`${BASE_URL}/api/admin/crack-code/teams`);
            if (teamsRes.ok) {
                const teamsData = await teamsRes.json();
                setTeams(teamsData.teams || []);
            }

            // Fetch winner info if session is active
            if (statusData.started) {
                const winnerRes = await adminFetch(`${BASE_URL}/api/admin/crack-code/winner-info`);
                const winnerData = await winnerRes.json();
                if (winnerData.winnerFound) {
                    setWinnerInfo(winnerData);
                } else {
                    setWinnerInfo(null);
                }
            } else {
                setWinnerInfo(null);
            }
        } catch (e) {
            console.error("Failed to fetch status", e);
        }
    }, []);

    React.useEffect(() => {
        document.title = "Crack Code // Admin";
        fetchStatus();
        const interval = setInterval(fetchStatus, 3000);
        return () => clearInterval(interval);
    }, [fetchStatus]);

    const handleSelectQuestion = async (questionId) => {
        if (isSessionActive || questionId === selectedQuestionId) return;
        const previous = selectedQuestionId;
        setSelectedQuestionId(questionId); // optimistic
        setQuestionError(null);
        try {
            const response = await adminFetch(`${BASE_URL}/api/admin/crack-code/question`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ questionId })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                setSelectedQuestionId(previous);
                setQuestionError(data.message || 'QUESTION SELECTION REJECTED.');
            }
        } catch {
            setSelectedQuestionId(previous);
            setQuestionError('NETWORK INTERRUPT: SELECTION FAILED.');
        }
    };

    const handleStartSession = async () => {
        if (!selectedQuestionId) {
            setStatus({ type: 'error', message: 'SELECT A QUESTION BEFORE STARTING.' });
            return;
        }
        setLoading(true);
        setStatus({ type: 'info', message: 'INJECTING SESSION DATA...' });

        try {
            const response = await adminFetch(`${BASE_URL}/api/admin/crack-code/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ questionId: selectedQuestionId })
            });

            const data = await response.json();

            if (response.ok) {
                setStatus({ type: 'success', message: 'SESSION BROADCAST SUCCESSFUL. GAME STARTED.' });
            } else {
                setStatus({ type: 'error', message: data.message || 'AUTHORIZATION FAILURE: START REJECTED.' });
            }
        } catch (error) {
            console.error("Admin Start Error:", error);
            setStatus({ type: 'error', message: 'NETWORK INTERRUPT: SYSTEMS OFFLINE.' });
        } finally {
            setLoading(false);
        }
    };

    const handleResetSession = async () => {
        if (!window.confirm("CAUTION: This will purge all active sessions. Proceed?")) return;

        setLoading(true);
        setStatus({ type: 'info', message: 'PURGING SESSION DATA...' });

        try {
            const response = await adminFetch(`${BASE_URL}/api/admin/crack-code/reset`, {
                method: 'DELETE'
            });

            if (response.ok) {
                setStatus({ type: 'success', message: 'SYSTEM RESET COMPLETE. ALL SESSIONS PURGED.' });
            } else {
                setStatus({ type: 'error', message: 'RESET PROTOCOL REJECTED.' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'NETWORK INTERRUPT: RESET FAILED.' });
        } finally {
            setLoading(false);
        }
    };

    const handleToggleEligibility = async (team) => {
        const nextEligible = !team.eligible;
        if (!nextEligible && team.sessionActive) {
            if (!window.confirm(`Remove "${team.name}" from Crack the Code and end their live session?`)) return;
        }
        setTeamActionId(team._id);
        try {
            const response = await adminFetch(`${BASE_URL}/api/admin/crack-code/teams/${team._id}/eligibility`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eligible: nextEligible }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setStatus({ type: 'success', message: data.message || `Updated "${team.name}" eligibility.` });
                await fetchStatus();
            } else {
                setStatus({ type: 'error', message: data.message || 'Failed to update team eligibility.' });
            }
        } catch {
            setStatus({ type: 'error', message: 'NETWORK INTERRUPT: ELIGIBILITY UPDATE FAILED.' });
        } finally {
            setTeamActionId(null);
        }
    };

    const handlePromoteWin = async (team) => {
        if (!window.confirm(`Promote "${team.name}" as the Crack the Code WINNER?`)) return;
        setTeamActionId(team._id);
        try {
            const response = await adminFetch(`${BASE_URL}/api/admin/crack-code/teams/${team._id}/promote-win`, {
                method: 'POST',
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setStatus({ type: 'success', message: data.message || `"${team.name}" promoted as winner.` });
                await fetchStatus();
            } else {
                setStatus({ type: 'error', message: data.message || 'Failed to promote winner.' });
            }
        } catch {
            setStatus({ type: 'error', message: 'NETWORK INTERRUPT: PROMOTE WIN FAILED.' });
        } finally {
            setTeamActionId(null);
        }
    };

    const handleTerminateTeam = async (team) => {
        if (!window.confirm(`Terminate active session for "${team.name}"? They will be removed from the live round.`)) return;
        setTeamActionId(team._id);
        try {
            const response = await adminFetch(`${BASE_URL}/api/admin/crack-code/teams/${team._id}/terminate`, {
                method: 'POST',
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setStatus({ type: 'success', message: data.message || `Terminated "${team.name}".` });
                await fetchStatus();
            } else {
                setStatus({ type: 'error', message: data.message || 'Failed to terminate team session.' });
            }
        } catch {
            setStatus({ type: 'error', message: 'NETWORK INTERRUPT: TERMINATE FAILED.' });
        } finally {
            setTeamActionId(null);
        }
    };

    const filteredTeams = teams.filter((t) => {
        const q = teamSearch.trim().toLowerCase();
        if (!q) return true;
        return (
            t.name.toLowerCase().includes(q) ||
            (t.members || []).some((m) => m.toLowerCase().includes(q))
        );
    });

    return (
        <div className="crack-admin-container">
            <div className="admin-overlay"></div>
            <div className="crack-admin-content">
                <header className="crack-admin-header">
                    <div className="admin-label">SYSTEM ADMINISTRATOR</div>
                    <h1 className="admin-title">CRACK ENGINE CONTROL</h1>
                    <div className="admin-subtitle">GATEWAY: CRACK-THE-CODE // SESSION MANAGER</div>
                </header>

                <div className="control-panel">
                    <div className="status-grid">
                        <div className="status-item">
                            <span className="label">ENGINE STATE:</span>
                            <span className={`value ${loading ? 'active' : (isSessionActive ? 'idle' : (eligibleCount > 0 ? 'standby' : 'error'))}`}>
                                {loading ? 'PROCESSING...' : (isSessionActive ? 'SESSION ACTIVE' : (eligibleCount > 0 ? 'READY' : 'NO TEAMS'))}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="label">SESSION STATUS:</span>
                            <span className="value safe">WINNERS_ONLY</span>
                        </div>
                        <div className="status-item">
                            <span className="label">ELIGIBLE TEAMS:</span>
                            <span className="value">{eligibleCount}</span>
                        </div>
                        <div className="status-item">
                            <span className="label">{isSessionActive ? 'LIVE QUESTION:' : 'QUEUED QUESTION:'}</span>
                            <span className="value">
                                {questions.find(q => q.id === (isSessionActive ? activeQuestionId : selectedQuestionId))?.title || '—'}
                            </span>
                        </div>
                    </div>

                    <div className="question-selector">
                        <div className="question-selector-header">
                            <span>ROUND PAYLOAD // SELECT QUESTION</span>
                            {isSessionActive && <span className="question-lock">LOCKED: RESET TO CHANGE</span>}
                        </div>
                        <div className="question-options" role="radiogroup" aria-label="Crack the Code question">
                            {questions.map((q) => {
                                const isSelected = q.id === (isSessionActive ? activeQuestionId : selectedQuestionId);
                                return (
                                    <button
                                        key={q.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={isSelected}
                                        className={`question-option ${isSelected ? 'selected' : ''}`}
                                        onClick={() => handleSelectQuestion(q.id)}
                                        disabled={loading || isSessionActive}
                                    >
                                        <span className="question-option-title">{q.title}</span>
                                        <span className="question-option-meta">
                                            {q.visibleCount} VISIBLE · {q.hiddenCount} HIDDEN
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        {questionsUnavailable && (
                            <div className="question-error">
                                QUESTION BANK UNREACHABLE AT {BASE_URL}. THE BACKEND MAY BE RUNNING AN OLDER BUILD.
                            </div>
                        )}
                        {questionError && <div className="question-error">{questionError}</div>}
                        {status?.type === 'error' && <div className="question-error">{status.message}</div>}
                    </div>

                    <div className="main-action">
                        <button
                            className={`deploy-button ${loading ? 'loading' : ''} ${isSessionActive ? 'disabled' : ''}`}
                            onClick={handleStartSession}
                            disabled={loading || isSessionActive || !selectedQuestionId}
                        >
                            <span className="btn-glitch-bg"></span>
                            <span className="btn-text">{loading ? 'BOOTING...' : (isSessionActive ? 'SESSION IN PROGRESS' : 'START SESSION')}</span>
                        </button>

                        <button
                            className="reset-button"
                            onClick={handleResetSession}
                            disabled={loading}
                        >
                            RESET SYSTEMS
                        </button>
                    </div>

                    {isSessionActive && (
                        <div className={`live-monitor ${winnerInfo ? 'winner-found' : ''}`}>
                            <div className="monitor-header">
                                <span className={`pulse-dot ${winnerInfo ? 'winner' : ''}`}></span>
                                {winnerInfo && winnerInfo.winner ? 'SESSION_STATE://WINNER_FINALIZED' : 'LIVE_MONITORING://SUBMISSION_STREAM'}
                            </div>

                            {winnerInfo && winnerInfo.winner ? (
                                <div className="winner-display">
                                    <div className="winner-banner">
                                        <div className="banner-glitch" data-text="MISSION ACCOMPLISHED">MISSION ACCOMPLISHED</div>
                                    </div>
                                    <div className="winner-details">
                                        <div className="winner-team-label">CHAMPION_UNIT:</div>
                                        <div className="winner-team-name">{winnerInfo.winner.teamName}</div>
                                        <div className="winner-members">
                                            {winnerInfo.winner.members.map((member, idx) => (
                                                <span key={idx} className="member-tag">{member}</span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="detection-wrapper">
                                    <div className="scanner-line"></div>
                                    <div className="detecting-text">
                                        DETECTING_WINNER<span className="dots">...</span>
                                    </div>
                                </div>
                            )}

                            {winnerInfo && winnerInfo.allBreaches && winnerInfo.allBreaches.length > 0 && (
                                <div className="breach-tracker">
                                    <div className="tracker-header">SUCCESSFUL_BREACH_LOGS ({winnerInfo.allBreaches.length})</div>
                                    <div className="breach-grid">
                                        {winnerInfo.allBreaches.map((breach) => (
                                            <div key={breach.id} className={`breach-card ${breach.isAbsoluteWinner ? 'winner-card' : ''}`}>
                                                <div className="breach-card-header">
                                                    <span className="timestamp">[{new Date(breach.submittedAt).toLocaleTimeString()}]</span>
                                                    {breach.isAbsoluteWinner && <span className="winner-badge">WINNER</span>}
                                                </div>
                                                <div className="breach-team-name">{breach.teamName}</div>
                                                <div className="breach-members">
                                                    {breach.members.join(", ")}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {status && (
                        <div className={`status-terminal ${status.type}`}>
                            <div className="terminal-header">SYSTEM_FEEDBACK://LOG</div>
                            <div className="terminal-body">
                                <span className="terminal-prompt">&gt; </span>{status.message}
                            </div>
                        </div>
                    )}

                    <section className="team-roster-panel">
                        <div className="roster-toolbar">
                            <div className="roster-title-group">
                                <span className="roster-title">TEAM ROSTER // ELIGIBILITY & SESSION CONTROL</span>
                                <span className="roster-counts">
                                    {eligibleCount} ELIGIBLE · {teams.length} TOTAL
                                </span>
                            </div>
                            <input
                                type="text"
                                className="roster-search"
                                placeholder="Search team or member..."
                                value={teamSearch}
                                onChange={(e) => setTeamSearch(e.target.value)}
                            />
                        </div>

                        <div className="roster-list">
                            {filteredTeams.length === 0 ? (
                                <div className="roster-empty">NO TEAMS MATCH CURRENT FILTER.</div>
                            ) : (
                                filteredTeams.map((team) => {
                                    const busy = teamActionId === team._id || loading;
                                    const statusBadge = team.isWinner
                                        ? { label: 'WINNER', cls: 'winner' }
                                        : team.sessionActive
                                            ? { label: 'PLAYING', cls: 'playing' }
                                            : team.hasSession && team.sessionEndedAt
                                                ? { label: 'ENDED', cls: 'ended' }
                                                : team.eligible
                                                    ? (team.manuallyAdded
                                                        ? { label: 'ADDED', cls: 'added' }
                                                        : { label: 'ELIGIBLE', cls: 'eligible' })
                                                    : { label: 'EXCLUDED', cls: 'excluded' };

                                    return (
                                        <div key={team._id} className={`roster-row ${team.eligible ? 'is-eligible' : ''}`}>
                                            <div className="roster-team-info">
                                                <div className="roster-team-top">
                                                    <span className="roster-team-name">{team.name}</span>
                                                    <span className={`roster-status-badge ${statusBadge.cls}`}>
                                                        {statusBadge.label}
                                                    </span>
                                                    {team.eligible && team.manuallyAdded && statusBadge.cls !== 'added' && (
                                                        <span className="roster-status-badge added">ADDED</span>
                                                    )}
                                                </div>
                                                <div className="roster-team-members">
                                                    {(team.members || []).join(' · ') || 'No members'}
                                                </div>
                                            </div>

                                            <div className="roster-actions">
                                                <button
                                                    type="button"
                                                    className={`roster-btn ${team.eligible ? 'remove' : 'add'}`}
                                                    onClick={() => handleToggleEligibility(team)}
                                                    disabled={busy}
                                                >
                                                    {team.eligible ? 'REMOVE' : '+ ADD'}
                                                </button>

                                                {team.sessionActive && (
                                                    <button
                                                        type="button"
                                                        className="roster-btn terminate"
                                                        onClick={() => handleTerminateTeam(team)}
                                                        disabled={busy}
                                                    >
                                                        TERMINATE
                                                    </button>
                                                )}

                                                {!team.isWinner && (
                                                    <button
                                                        type="button"
                                                        className="roster-btn promote"
                                                        onClick={() => handlePromoteWin(team)}
                                                        disabled={busy || !!(winnerInfo && winnerInfo.winnerFound)}
                                                        title={winnerInfo && winnerInfo.winnerFound ? 'Reset systems first to change winner' : 'Promote this team as Crack the Code winner'}
                                                    >
                                                        PROMOTE WIN
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </section>
                </div>

                <footer className="admin-footer">
                    <div className="footer-line">ACCESS LEVEL: OVERSIGHT</div>
                    <div className="footer-line">LAST_HEARTBEAT: {new Date().toLocaleTimeString()}</div>
                </footer>
            </div>
        </div>
    );
};

export default CrackCodeAdmin;
