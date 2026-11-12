import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import '../../pages/Admin.css'; // Reuse existing admin styles for theme consistency
import { adminLogin } from '../../api/adminAuth';

const AdminLogin = () => {
    const [searchParams] = useSearchParams();
    const expiredNotice = searchParams.get('expired') === '1'
        ? 'ADMIN SESSION EXPIRED — PLEASE RE-AUTHENTICATE'
        : '';
    const [passcode, setPasscode] = useState('');
    const [error, setError] = useState(expiredNotice);
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    // Passcode is verified by the backend, which returns a signed admin token
    const handleLogin = async (e) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setError('');
        try {
            await adminLogin(passcode);
            navigate('/admin/dashboard');
        } catch (err) {
            setError(err.message === 'Failed to fetch' ? 'NETWORK INTERRUPT: SERVER UNREACHABLE' : err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="admin-page-root" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div className="admin-scanlines"></div>
            <div className="admin-grid-overlay"></div>

            <div className="login-container" style={{
                position: 'relative',
                zIndex: 20,
                padding: '2.5rem 2.25rem',
                background: 'linear-gradient(180deg, #12131b 0%, #090a0f 100%)',
                border: '2px solid #f27042',
                borderRadius: '4px',
                textAlign: 'center',
                maxWidth: '420px',
                width: '100%',
                boxShadow: 'inset 0 0 0 3px #090a0f, inset 0 0 0 4px rgba(245, 165, 36, 0.35), 6px 6px 0 #4a1c10, 0 28px 70px rgba(0,0,0,0.85)'
            }}>
                <span className="admin-toast-corner tl" style={{ width: '12px', height: '12px', borderColor: '#f5a524', top: '-6px', left: '-6px' }} aria-hidden="true" />
                <span className="admin-toast-corner tr" style={{ width: '12px', height: '12px', borderColor: '#f5a524', top: '-6px', right: '-6px' }} aria-hidden="true" />
                <span className="admin-toast-corner bl" style={{ width: '12px', height: '12px', borderColor: '#f5a524', bottom: '-6px', left: '-6px' }} aria-hidden="true" />
                <span className="admin-toast-corner br" style={{ width: '12px', height: '12px', borderColor: '#f5a524', bottom: '-6px', right: '-6px' }} aria-hidden="true" />

                <h1 style={{
                    fontFamily: "'Anton', Impact, 'Arial Narrow Bold', sans-serif",
                    fontSize: '2.1rem',
                    letterSpacing: '0.1em',
                    color: '#f5a524',
                    marginBottom: '1.75rem',
                    marginTop: 0,
                    textShadow: '2px 2px 0 #3a150b'
                }}>SYSTEM ACCESS</h1>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <input
                        type="password"
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value)}
                        placeholder="ENTER PASSCODE"
                        style={{
                            background: 'rgba(8, 9, 14, 0.9)',
                            border: '1.5px solid rgba(245, 165, 36, 0.4)',
                            borderRadius: '3px',
                            padding: '0.95rem 1rem',
                            color: '#faf1dc',
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontWeight: 700,
                            textAlign: 'center',
                            letterSpacing: '0.18em',
                            fontSize: '1rem',
                            outline: 'none'
                        }}
                    />

                    {error && <div style={{ color: '#f27042', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 700, fontSize: '0.82rem' }}>{error}</div>}

                    <button
                        type="submit"
                        className="cyber-btn primary"
                        style={{ padding: '0.95rem' }}
                        disabled={submitting}
                    >
                        {submitting ? 'VERIFYING...' : 'AUTHENTICATE'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AdminLogin;
