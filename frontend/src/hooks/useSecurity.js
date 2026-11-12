import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { getSecuritySettings, postSecurityLog } from '../api/securityAdmin';
import './useSecurity.css';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

let lastPolicyToastTime = 0;
let lastAlertKey = "";
let lastAlertTime = 0;

const removeLegacyInlineStyles = () => {
    const legacyToast = document.getElementById('security-toast-styles');
    if (legacyToast) legacyToast.remove();
    const legacyGate = document.getElementById('security-fs-gate-styles');
    if (legacyGate) legacyGate.remove();
};

const getArenaPageLabel = () => {
    const path = (window.location?.pathname || "").toLowerCase();
    if (path.includes('/deadlock/game')) return 'ROUND 01 // ARENA';
    if (path.includes('/deadlock/lobby')) return 'ROUND 01 // LOBBY';
    if (path.includes('/crackthecode')) return 'ROUND 02 // CRACK THE CODE';
    return path || 'PLAYER';
};

const IS_MAC_PLATFORM = /Mac|iPhone|iPad|iPod/i.test(
    typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent || '') : ''
);

const normalizeShortcutKey = (e) => {
    if (e.code === 'Period') return '.';
    if (e.code === 'Comma') return ',';
    if (e.code === 'Semicolon') return ';';
    if (e.code === 'PrintScreen' || e.key === 'PrintScreen') return 'PrintScreen';
    if (e.key === ' ') return 'Space';
    if (e.key === 'OS' || e.key === 'Meta') return IS_MAC_PLATFORM ? 'Cmd' : 'Win';
    if (!e.key) return `Key(${e.keyCode})`;
    return e.key.length === 1 ? e.key.toUpperCase() : e.key;
};

const formatShortcutLabel = (e) => {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push(IS_MAC_PLATFORM ? 'Cmd' : 'Win');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const keyName = normalizeShortcutKey(e);
    if (!['Control', 'Meta', 'Alt', 'Shift', 'Win', 'Cmd', 'OS'].includes(keyName)) {
        parts.push(keyName);
    }
    if (parts.length === 0) return keyName;
    return parts.join('+');
};

const WIN_SHORTCUT_LABELS = {
    tab: { action: 'Win+Tab', category: 'SHORTCUT', label: 'Task View / New Workspace' },
    'shift+s': { action: 'Win+Shift+S', category: 'SHORTCUT', label: 'Snipping Tool Screenshot' },
    'shift+r': { action: 'Win+Shift+R', category: 'SHORTCUT', label: 'Snipping Tool Screen Record' },
    'alt+r': { action: 'Win+Alt+R', category: 'SHORTCUT', label: 'Game Bar Screen Record' },
    'ctrl+d': { action: 'Win+Ctrl+D', category: 'SHORTCUT', label: 'New Virtual Desktop' },
    'ctrl+arrowleft': { action: 'Win+Ctrl+Left', category: 'SHORTCUT', label: 'Switch Virtual Desktop' },
    'ctrl+arrowright': { action: 'Win+Ctrl+Right', category: 'SHORTCUT', label: 'Switch Virtual Desktop' },
    '.': { action: 'Win+.', category: 'SHORTCUT', label: 'Emoji / Symbol Panel' },
    ';': { action: 'Win+;', category: 'SHORTCUT', label: 'Emoji / Symbol Panel' },
    ',': { action: 'Win+,', category: 'SHORTCUT', label: 'Desktop Peek' },
    d: { action: 'Win+D', category: 'SHORTCUT', label: 'Show Desktop' },
    g: { action: 'Win+G', category: 'SHORTCUT', label: 'Xbox Game Bar / Capture' },
    v: { action: 'Win+V', category: 'PASTE', label: 'Windows Clipboard History' },
    h: { action: 'Win+H', category: 'SHORTCUT', label: 'Voice Typing' },
    e: { action: 'Win+E', category: 'SHORTCUT', label: 'File Explorer' },
    r: { action: 'Win+R', category: 'SHORTCUT', label: 'Run Dialog' },
    printscreen: { action: 'Win+PrintScreen', category: 'SHORTCUT', label: 'Full-Screen Screenshot' }
};

const BROWSER_SHORTCUT_LABELS = {
    u: 'View Page Source',
    s: 'Save Page',
    p: 'Print Page',
    h: 'Browser History',
    j: 'Browser Downloads',
    n: 'New Browser Window',
    t: 'New Browser Tab',
    w: 'Close Tab / Window'
};

const buildLockGateHtml = ({ badge, titleTop, titleSub, desc }) => `
    <div class="loc-fs-card">
        <span class="loc-fs-corner tl" aria-hidden="true"></span>
        <span class="loc-fs-corner tr" aria-hidden="true"></span>
        <span class="loc-fs-corner bl" aria-hidden="true"></span>
        <span class="loc-fs-corner br" aria-hidden="true"></span>

        <div class="loc-fs-divider" aria-hidden="true">
            <span class="loc-fs-bracket">
                <span class="loc-fs-hook left"></span>
                <span class="loc-fs-dash"></span>
                <span class="loc-fs-dash"></span>
            </span>
            <span class="loc-fs-parallelogram">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>${badge}</span>
            </span>
            <span class="loc-fs-bracket">
                <span class="loc-fs-dash"></span>
                <span class="loc-fs-dash"></span>
                <span class="loc-fs-hook right"></span>
            </span>
        </div>

        <div class="loc-fs-title-top">${titleTop}</div>
        <div class="loc-fs-title-sub">
            <span>${titleSub}</span>
            <span class="loc-fs-underscore" aria-hidden="true"></span>
        </div>

        <p class="loc-fs-desc" style="margin-bottom: 0;">
            ${desc}
        </p>
    </div>
`;

const useSecurity = (teamName, options = {}) => {
    const { passive = false } = options;

    const [security, setSecurity] = useState({
        disableCopyPaste: false,
        disableTextSelection: false,
        allowDevTools: false,
        forceFullscreen: false,
        blockDevTools: false,
        blockAiAssistant: false,
        enableLogging: false
    });

    const socketRef = useRef(null);
    const securityRef = useRef(security);
    const teamNameRef = useRef(teamName);
    const dedupeMapRef = useRef(new Map());
    const lastVisibilityHiddenAtRef = useRef(0);
    const lastFullscreenTransitionAtRef = useRef(0);
    const transientShieldUntilRef = useRef(0);

    useEffect(() => {
        securityRef.current = security;
    }, [security]);

    useEffect(() => {
        if (teamName && teamName !== 'UNKNOWN') {
            teamNameRef.current = teamName;
        } else {
            teamNameRef.current = localStorage.getItem('teamName') || teamName || 'UNKNOWN';
        }
    }, [teamName]);

    useEffect(() => {
        if (!passive) return;
        transientShieldUntilRef.current = 0;
        const overlayIds = [
            'security-focus-shield',
            'security-fullscreen-gate',
            'security-devtools-gate',
            'security-ai-gate'
        ];
        overlayIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        document.querySelectorAll('[id^="security-alert-"]').forEach((el) => el.remove());
    }, [passive]);

    useEffect(() => {
        if (passive) return undefined;

        const fetchSettings = async () => {
            try {
                const res = await getSecuritySettings();
                if (res.success && res.settings) {
                    setSecurity(prev => {
                        if (JSON.stringify(prev) !== JSON.stringify(res.settings)) {
                            return res.settings;
                        }
                        return prev;
                    });
                }
            } catch (err) {
                console.error(">>> [SECURITY_HOOK] Fetch failed:", err);
            }
        };

        fetchSettings();
        const pollInterval = setInterval(fetchSettings, 10000);

        const socketHost = BASE_URL || undefined;
        socketRef.current = io(socketHost, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            transports: ['polling', 'websocket']
        });

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-team', teamNameRef.current || 'UNKNOWN');
        });

        socketRef.current.on('security-settings-updated', (newSettings) => {
            setSecurity(newSettings);
            removeLegacyInlineStyles();

            const now = Date.now();
            if (now - lastPolicyToastTime < 500) return;
            lastPolicyToastTime = now;

            const toast = document.createElement('div');
            toast.className = 'loc-policy-toast';
            toast.innerHTML = `
                <span class="loc-toast-corner tl"></span>
                <span class="loc-toast-corner tr"></span>
                <span class="loc-toast-corner bl"></span>
                <span class="loc-toast-corner br"></span>
                <span class="loc-policy-chip"><span>SYNC</span></span>
                <span class="loc-policy-text">SECURITY POLICY UPDATED</span>
            `;
            document.body.appendChild(toast);
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.style.animation = 'securityToastOut 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards';
                    setTimeout(() => toast.remove(), 280);
                }
            }, 2200);
        });

        socketRef.current.on('connect_error', (error) => {
            console.error(">>> [SECURITY_HOOK] Connection error:", error);
        });

        return () => {
            clearInterval(pollInterval);
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, [passive]);

    const sendLogPayload = useCallback((payload) => {
        const socket = socketRef.current;
        if (socket && socket.connected) {
            socket.timeout(2500).emit('report-security-violation', payload, (err, ack) => {
                if (err || !ack?.ok) {
                    postSecurityLog(payload).catch(() => {});
                }
            });
            return;
        }
        postSecurityLog(payload).catch(() => {});
    }, []);

    const reportAction = useCallback((typeOrPayload, legacyMessage = '') => {
        if (passive || !securityRef.current.enableLogging) return;

        const payloadInput = typeof typeOrPayload === 'object' && typeOrPayload !== null
            ? typeOrPayload
            : { type: typeOrPayload, message: legacyMessage };

        const category = String(payloadInput.category || payloadInput.type || 'OTHER').toUpperCase();
        const dedupeKey = payloadInput.dedupeKey || `${category}:${payloadInput.action || ''}`;
        const now = Date.now();
        const cooldownMs = Number(payloadInput.cooldownMs ?? 450);

        const prevTime = dedupeMapRef.current.get(dedupeKey) || 0;
        if (now - prevTime < cooldownMs) return;
        dedupeMapRef.current.set(dedupeKey, now);

        const resolvedTeam = (teamNameRef.current && teamNameRef.current !== 'UNKNOWN')
            ? teamNameRef.current
            : (localStorage.getItem('teamName') || 'UNKNOWN');

        const payload = {
            teamName: resolvedTeam,
            type: payloadInput.type || 'ALERT',
            category,
            action: payloadInput.action || '',
            message: payloadInput.message || legacyMessage || 'Security policy event',
            page: payloadInput.page || getArenaPageLabel(),
            blocked: typeof payloadInput.blocked === 'boolean' ? payloadInput.blocked : true,
            timestamp: new Date().toISOString()
        };

        sendLogPayload(payload);
    }, [passive, sendLogPayload]);

    // Retro-circuit security alert banner matching the LARPER OR CODER theme
    // Always shows a generic violation notice so internal detection rules are never exposed to players
    const showSecurityAlert = useCallback(() => {
        if (passive) return;
        removeLegacyInlineStyles();

        const titleText = 'SECURITY VIOLATION DETECTED';
        const descText = 'Restricted activity detected and logged to the referee console.';

        const now = Date.now();
        if (lastAlertKey === titleText && now - lastAlertTime < 500) return;
        lastAlertKey = titleText;
        lastAlertTime = now;

        const existingAlerts = document.querySelectorAll('[id^="security-alert-"]');
        existingAlerts.forEach((el) => el.remove());

        const id = 'security-alert-' + Math.random().toString(36).slice(2, 11);
        const container = document.createElement('div');
        container.id = id;

        container.innerHTML = `
            <div class="security-toast-card">
                <span class="loc-toast-corner tl"></span>
                <span class="loc-toast-corner tr"></span>
                <span class="loc-toast-corner bl"></span>
                <span class="loc-toast-corner br"></span>
                <div class="security-toast-header">
                    <div class="security-toast-tag">
                        <span class="security-toast-dot"></span>
                        <span>INTEGRITY ALERT</span>
                    </div>
                    <span class="security-toast-status">REPORTED // CORE</span>
                </div>
                <div class="security-toast-body">
                    <div class="security-toast-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f27042" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                    </div>
                    <div class="security-toast-content">
                        <div class="security-toast-title">${titleText}</div>
                        <div class="security-toast-desc">${descText}</div>
                    </div>
                </div>
                <div class="security-toast-progress">
                    <div class="security-toast-bar"></div>
                </div>
            </div>
        `;

        container.style.cssText = `
            position: fixed;
            top: 22px;
            right: 22px;
            z-index: 2147483647;
            pointer-events: none;
            animation: securityToastIn 0.28s cubic-bezier(0.22, 1.18, 0.36, 1) forwards;
            font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
        `;

        document.body.appendChild(container);

        setTimeout(() => {
            if (container.parentNode) {
                container.style.animation = 'securityToastOut 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards';
                setTimeout(() => container.remove(), 320);
            }
        }, 6000);
    }, [passive]);

    // Core continuous monitoring + clipboard & shortcut interception
    useEffect(() => {
        if (passive) return undefined;

        let blurTimer = null;
        let metaKeyTimer = null;
        let transientShieldTimer = null;
        let windowBlurReported = false;

        const activateTransientShield = (durationMs = 5000) => {
            const shieldActivePolicy = securityRef.current.enableLogging ||
                securityRef.current.blockAiAssistant ||
                securityRef.current.blockDevTools;
            if (!shieldActivePolicy) return;

            const SHIELD_ID = 'security-focus-shield';
            const unlockAt = Date.now() + durationMs;
            if (unlockAt > transientShieldUntilRef.current) {
                transientShieldUntilRef.current = unlockAt;
            }

            if (!document.getElementById(SHIELD_ID)) {
                removeLegacyInlineStyles();
                const shield = document.createElement('div');
                shield.id = SHIELD_ID;
                shield.innerHTML = buildLockGateHtml({
                    badge: 'LOCKED',
                    titleTop: 'SECURITY',
                    titleSub: 'LOCKED',
                    desc: 'Security integrity verification is active. Keep focus on the arena and wait a moment to resume.'
                });
                shield.addEventListener('click', () => {
                    window.focus();
                    if (Date.now() < transientShieldUntilRef.current) return;
                    if (!securityRef.current.blockAiAssistant || (document.hasFocus() && document.visibilityState === 'visible')) {
                        shield.remove();
                    }
                });
                document.body.appendChild(shield);
            }

            if (transientShieldTimer) clearTimeout(transientShieldTimer);
            const waitMs = Math.max(durationMs, transientShieldUntilRef.current - Date.now());
            transientShieldTimer = setTimeout(() => {
                transientShieldTimer = null;
                if (Date.now() < transientShieldUntilRef.current) return;
                const canClear = !securityRef.current.blockAiAssistant ||
                    (document.hasFocus() && document.visibilityState === 'visible');
                if (canClear) {
                    const el = document.getElementById(SHIELD_ID);
                    if (el) el.remove();
                }
            }, waitMs);
        };

        // 1. Tab Visibility Change Detection (Tab Switch / Minimized)
        const handleVisibilityChange = () => {
            if (metaKeyTimer) {
                clearTimeout(metaKeyTimer);
                metaKeyTimer = null;
            }
            if (!securityRef.current.enableLogging) return;
            if (document.visibilityState === 'hidden') {
                lastVisibilityHiddenAtRef.current = Date.now();
                if (blurTimer) {
                    clearTimeout(blurTimer);
                    blurTimer = null;
                }
                reportAction({
                    type: 'TAB_SWITCH',
                    category: 'TAB_SWITCH',
                    action: 'Tab Switch',
                    message: 'Switched browser tab or minimized window',
                    blocked: false,
                    cooldownMs: 800
                });
                showSecurityAlert();
            }
        };

        // 2. Window Blur Detection (Alt+Tab / Win+Tab / Switching to another window)
        const handleWindowBlur = () => {
            if (metaKeyTimer) {
                clearTimeout(metaKeyTimer);
                metaKeyTimer = null;
            }
            if (!securityRef.current.enableLogging) return;
            if (blurTimer) clearTimeout(blurTimer);
            blurTimer = setTimeout(() => {
                blurTimer = null;
                if (!securityRef.current.enableLogging) return;
                if (windowBlurReported) return;
                if (document.visibilityState === 'hidden') return;
                if (Date.now() - lastVisibilityHiddenAtRef.current < 1000) return;
                if (Date.now() - lastFullscreenTransitionAtRef.current < 800) return;
                if (document.hasFocus()) return;

                windowBlurReported = true;
                reportAction({
                    type: 'WINDOW_SWITCH',
                    category: 'WINDOW_SWITCH',
                    action: 'Window Blur',
                    message: 'Lost window focus (Alt+Tab / Win+Tab / External App)',
                    blocked: false,
                    cooldownMs: 1000
                });
                showSecurityAlert();
            }, 140);
        };

        const handleWindowFocus = () => {
            if (blurTimer) {
                clearTimeout(blurTimer);
                blurTimer = null;
            }
            windowBlurReported = false;
        };

        // 3. DOM Clipboard Events (Copy / Cut / Paste via menu or keyboard)
        const handleClipboard = (e) => {
            if (!securityRef.current.disableCopyPaste) return;
            e.preventDefault();
            e.stopPropagation();

            const eventType = String(e.type || 'paste').toLowerCase();
            const category = eventType === 'copy' ? 'COPY' : eventType === 'cut' ? 'CUT' : 'PASTE';

            reportAction({
                type: 'ALERT',
                category,
                action: eventType,
                dedupeKey: `CLIP:${category}`,
                message: `Blocked ${eventType} attempt`,
                blocked: true,
                cooldownMs: 450
            });
            showSecurityAlert();
        };

        // 4. Drag & Drop Paste Prevention
        const handleDrop = (e) => {
            if (!securityRef.current.disableCopyPaste) return;
            const hasPayload = e.dataTransfer?.files?.length > 0 || e.dataTransfer?.types?.length > 0;
            if (!hasPayload) return;

            e.preventDefault();
            e.stopPropagation();
            reportAction({
                type: 'ALERT',
                category: 'PASTE',
                action: 'drag_drop',
                dedupeKey: 'CLIP:PASTE',
                message: 'Blocked drag-and-drop content into workspace',
                blocked: true,
                cooldownMs: 500
            });
            showSecurityAlert();
        };

        // 5. Capture-phase Keyboard Interception (Clipboard, Context Menu, DevTools, AI, Windows & System Shortcuts)
        const handleGlobalKeys = (e) => {
            const rawKey = normalizeShortcutKey(e);
            const key = rawKey.toLowerCase();
            const hasCmdOrCtrl = e.ctrlKey || e.metaKey;
            const combo = formatShortcutLabel(e);

            // Allow Ctrl+Enter / Cmd+Enter explicitly (used to submit solutions)
            if (hasCmdOrCtrl && !e.altKey && !e.shiftKey && key === 'enter') return;

            const monitorShortcuts = securityRef.current.enableLogging ||
                securityRef.current.blockDevTools ||
                securityRef.current.blockAiAssistant;

            // A. PrintScreen key (keydown check + 5s shield)
            if (key === 'printscreen') {
                e.preventDefault();
                e.stopPropagation();
                if (monitorShortcuts) {
                    activateTransientShield(5000);
                    reportAction({
                        type: 'ALERT',
                        category: 'SHORTCUT',
                        action: combo,
                        dedupeKey: `SHORTCUT:${combo}`,
                        message: `Screenshot shortcut triggered (${combo})`,
                        blocked: true,
                        cooldownMs: 800
                    });
                    showSecurityAlert();
                }
                return;
            }

            // B. Windows Key / Win+* combos (apply at least 5s opaque shield + crisp admin log)
            if (!IS_MAC_PLATFORM && (key === 'win' || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();

                if (monitorShortcuts) {
                    activateTransientShield(5000);

                    // Bare Win key press without follow-up key
                    if (key === 'win') {
                        if (metaKeyTimer) clearTimeout(metaKeyTimer);
                        metaKeyTimer = setTimeout(() => {
                            metaKeyTimer = null;
                            reportAction({
                                type: 'ALERT',
                                category: 'SHORTCUT',
                                action: 'Win',
                                dedupeKey: 'SHORTCUT:Win',
                                message: 'Windows Start / Meta key pressed (Win)',
                                blocked: true,
                                cooldownMs: 700
                            });
                            showSecurityAlert();
                        }, 260);
                        return;
                    }

                    if (metaKeyTimer) {
                        clearTimeout(metaKeyTimer);
                        metaKeyTimer = null;
                    }

                    const subParts = [];
                    if (e.ctrlKey) subParts.push('ctrl');
                    if (e.altKey) subParts.push('alt');
                    if (e.shiftKey) subParts.push('shift');
                    subParts.push(key);
                    const lookupKey = subParts.join('+');
                    const matched = WIN_SHORTCUT_LABELS[lookupKey];

                    const resolvedAction = matched?.action || combo;
                    const resolvedCategory = matched?.category || 'SHORTCUT';
                    const resolvedLabel = matched?.label || 'Windows System Shortcut';

                    reportAction({
                        type: 'ALERT',
                        category: resolvedCategory,
                        action: resolvedAction,
                        dedupeKey: `${resolvedCategory}:${resolvedAction}`,
                        message: `${resolvedLabel} shortcut used (${resolvedAction})`,
                        blocked: true,
                        cooldownMs: 650
                    });
                    showSecurityAlert();
                }
                return;
            }

            // Ignore bare Ctrl / Shift / Alt modifier presses
            if (['control', 'shift', 'alt'].includes(key)) return;

            // C. Context menu keyboard shortcuts (Shift+F10, ContextMenu key)
            if ((securityRef.current.blockDevTools || securityRef.current.blockAiAssistant || securityRef.current.enableLogging) &&
                ((e.shiftKey && key === 'f10') || key === 'contextmenu')) {
                e.preventDefault();
                e.stopPropagation();
                reportAction({
                    type: 'ALERT',
                    category: 'CONTEXT_MENU',
                    action: combo,
                    message: `Context menu shortcut attempted (${combo})`,
                    blocked: true,
                    cooldownMs: 500
                });
                showSecurityAlert();
                return;
            }

            // D. DevTools / Inspect shortcuts (checked before clipboard so Ctrl+Shift+C goes to DevTools)
            if (securityRef.current.blockDevTools || securityRef.current.enableLogging) {
                const isF12 = key === 'f12' || e.keyCode === 123;
                const isCtrlShiftDev = hasCmdOrCtrl && e.shiftKey && ['i', 'j', 'c', 'k', 'e', 'm', 'p'].includes(key);
                const isMacOptionDev = IS_MAC_PLATFORM && e.metaKey && e.altKey && ['i', 'j', 'c', 'u', 'k'].includes(key);
                const isF1Palette = key === 'f1';

                if (isF12 || isCtrlShiftDev || isMacOptionDev || isF1Palette) {
                    const devLabelMap = {
                        i: 'DevTools Inspector',
                        j: 'DevTools Console',
                        c: 'Element Picker',
                        k: 'Web Console',
                        e: 'Network Panel',
                        m: 'Device Toolbar',
                        p: 'Command Palette / System Print'
                    };
                    const desc = isF12
                        ? 'DevTools (F12)'
                        : isF1Palette
                            ? 'Editor Command Palette (F1)'
                            : `${devLabelMap[key] || 'DevTools/Inspect'} (${combo})`;

                    if (securityRef.current.blockDevTools || !isF1Palette) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    if (securityRef.current.blockDevTools || isF12 || isCtrlShiftDev || isMacOptionDev) {
                        reportAction({
                            type: 'ALERT',
                            category: isF1Palette ? 'SHORTCUT' : 'DEVTOOLS',
                            action: combo,
                            message: `Blocked ${desc}`,
                            blocked: Boolean(securityRef.current.blockDevTools),
                            cooldownMs: 500
                        });
                        if (securityRef.current.blockDevTools) {
                            showSecurityAlert();
                        }
                        return;
                    }
                }
            }

            // E. Clipboard shortcuts when Copy/Paste is disabled
            if (securityRef.current.disableCopyPaste) {
                const isDirectClip = hasCmdOrCtrl && !e.altKey && !e.shiftKey && ['c', 'x', 'v'].includes(key);
                const isPasteNoFormat = hasCmdOrCtrl && e.shiftKey && !e.altKey && key === 'v';
                if (isDirectClip || isPasteNoFormat) {
                    const category = key === 'c' ? 'COPY' : key === 'x' ? 'CUT' : 'PASTE';
                    e.preventDefault();
                    e.stopPropagation();
                    reportAction({
                        type: 'ALERT',
                        category,
                        action: combo,
                        dedupeKey: `CLIP:${category}`,
                        message: `Blocked ${category.toLowerCase()} shortcut (${combo})`,
                        blocked: true,
                        cooldownMs: 450
                    });
                    showSecurityAlert();
                    return;
                }

                if ((e.shiftKey && key === 'insert') || (e.ctrlKey && !e.shiftKey && key === 'insert')) {
                    const category = e.shiftKey ? 'PASTE' : 'COPY';
                    e.preventDefault();
                    e.stopPropagation();
                    reportAction({
                        type: 'ALERT',
                        category,
                        action: combo,
                        dedupeKey: `CLIP:${category}`,
                        message: `Blocked ${category.toLowerCase()} shortcut (${combo})`,
                        blocked: true,
                        cooldownMs: 450
                    });
                    showSecurityAlert();
                    return;
                }
            }

            // F. Gemini in Chrome / Side Panel / Omnibox & Chrome Menu shortcuts
            if (securityRef.current.blockAiAssistant || securityRef.current.enableLogging) {
                const isWinGeminiSidePanel = !IS_MAC_PLATFORM && e.altKey && !e.ctrlKey && !e.metaKey && key === 'g';
                const isMacGeminiSidePanel = IS_MAC_PLATFORM && e.ctrlKey && !e.altKey && key === 'g';
                const isOmniboxJump = (hasCmdOrCtrl && !e.shiftKey && !e.altKey && key === 'l') ||
                    (e.altKey && !e.ctrlKey && !e.metaKey && key === 'd') ||
                    key === 'f6';
                const isChromeMenu = (!IS_MAC_PLATFORM && e.altKey && ['e', 'f'].includes(key)) || key === 'f10';

                if (isWinGeminiSidePanel || isMacGeminiSidePanel || isOmniboxJump || isChromeMenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    const category = isChromeMenu ? 'SHORTCUT' : 'AI_ASSISTANT';
                    const reason = isWinGeminiSidePanel || isMacGeminiSidePanel
                        ? 'Gemini / AI Side Panel'
                        : isOmniboxJump
                            ? 'Address Bar (@gemini) Jump'
                            : 'Chrome Menu Bar';
                    reportAction({
                        type: 'ALERT',
                        category,
                        action: combo,
                        message: `Blocked ${reason} shortcut (${combo})`,
                        blocked: true,
                        cooldownMs: 500
                    });
                    showSecurityAlert();
                    return;
                }
            }

            // G. Fullscreen exit shortcut when Force Fullscreen is active
            if (securityRef.current.forceFullscreen && key === 'f11') {
                e.preventDefault();
                e.stopPropagation();
                reportAction({
                    type: 'ALERT',
                    category: 'FULLSCREEN',
                    action: 'F11',
                    message: 'Blocked Fullscreen toggle shortcut (F11)',
                    blocked: true,
                    cooldownMs: 600
                });
                showSecurityAlert();
                return;
            }

            // H. Browser & Tab Manipulation Shortcuts (View Source, Save, Print, History, Downloads, Tabs/Windows)
            if (monitorShortcuts) {
                if (hasCmdOrCtrl && e.shiftKey && !e.altKey && key === 'delete') {
                    e.preventDefault();
                    e.stopPropagation();
                    reportAction({
                        type: 'ALERT',
                        category: 'SHORTCUT',
                        action: combo,
                        message: `Blocked Clear Browsing Data shortcut (${combo})`,
                        blocked: true,
                        cooldownMs: 500
                    });
                    showSecurityAlert();
                    return;
                }

                if (hasCmdOrCtrl && e.shiftKey && !e.altKey && ['n', 't'].includes(key)) {
                    const desc = key === 'n' ? 'New Incognito Window' : 'Reopen Closed Tab';
                    e.preventDefault();
                    e.stopPropagation();
                    reportAction({
                        type: 'ALERT',
                        category: 'SHORTCUT',
                        action: combo,
                        message: `Attempted ${desc} shortcut (${combo})`,
                        blocked: true,
                        cooldownMs: 500
                    });
                    showSecurityAlert();
                    return;
                }

                if (hasCmdOrCtrl && !e.shiftKey && !e.altKey && BROWSER_SHORTCUT_LABELS[key]) {
                    const label = BROWSER_SHORTCUT_LABELS[key];
                    e.preventDefault();
                    e.stopPropagation();
                    reportAction({
                        type: 'ALERT',
                        category: 'SHORTCUT',
                        action: combo,
                        message: `Blocked ${label} shortcut (${combo})`,
                        blocked: true,
                        cooldownMs: 500
                    });
                    showSecurityAlert();
                    return;
                }

                // Mac Cmd+Shift+3/4/5/6 screenshot combos
                if (e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(key)) {
                    activateTransientShield(5000);
                    reportAction({
                        type: 'ALERT',
                        category: 'SHORTCUT',
                        action: combo,
                        message: `Mac screenshot shortcut used (${combo})`,
                        blocked: false,
                        cooldownMs: 800
                    });
                    showSecurityAlert();
                }
            }
        };

        // PrintScreen fires reliably on keyup on Windows even if keydown is swallowed
        const handleGlobalKeyUp = (e) => {
            const key = normalizeShortcutKey(e).toLowerCase();
            if (key === 'printscreen') {
                const combo = formatShortcutLabel(e);
                if (securityRef.current.enableLogging || securityRef.current.blockAiAssistant || securityRef.current.blockDevTools) {
                    activateTransientShield(5000);
                    reportAction({
                        type: 'ALERT',
                        category: 'SHORTCUT',
                        action: combo,
                        dedupeKey: `SHORTCUT:${combo}`,
                        message: `Screenshot key pressed (${combo})`,
                        blocked: false,
                        cooldownMs: 800
                    });
                    showSecurityAlert();
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleWindowBlur);
        window.addEventListener('focus', handleWindowFocus);
        window.addEventListener('paste', handleClipboard, true);
        window.addEventListener('copy', handleClipboard, true);
        window.addEventListener('cut', handleClipboard, true);
        window.addEventListener('drop', handleDrop, true);
        window.addEventListener('keydown', handleGlobalKeys, true);
        window.addEventListener('keyup', handleGlobalKeyUp, true);

        return () => {
            if (blurTimer) clearTimeout(blurTimer);
            if (metaKeyTimer) clearTimeout(metaKeyTimer);
            if (transientShieldTimer) clearTimeout(transientShieldTimer);
            transientShieldUntilRef.current = 0;
            const activeShield = document.getElementById('security-focus-shield');
            if (activeShield) activeShield.remove();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleWindowBlur);
            window.removeEventListener('focus', handleWindowFocus);
            window.removeEventListener('paste', handleClipboard, true);
            window.removeEventListener('copy', handleClipboard, true);
            window.removeEventListener('cut', handleClipboard, true);
            window.removeEventListener('drop', handleDrop, true);
            window.removeEventListener('keydown', handleGlobalKeys, true);
            window.removeEventListener('keyup', handleGlobalKeyUp, true);
        };
    }, [passive, reportAction, showSecurityAlert]);

    // Enforce Admin "Turn Full Screen" policy across active player views
    useEffect(() => {
        if (passive) return undefined;

        const GATE_ID = 'security-fullscreen-gate';
        const getFullscreenElement = () =>
            document.fullscreenElement || document.webkitFullscreenElement || null;

        const enterFullscreen = () => {
            const el = document.documentElement;
            const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
            if (!req) return Promise.resolve(false);
            lastFullscreenTransitionAtRef.current = Date.now();
            try {
                return Promise.resolve(req.call(el)).then(() => true).catch(() => false);
            } catch {
                return Promise.resolve(false);
            }
        };

        const exitFullscreen = () => {
            if (!getFullscreenElement()) return;
            const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
            if (!exit) return;
            lastFullscreenTransitionAtRef.current = Date.now();
            try {
                Promise.resolve(exit.call(document)).catch(() => {});
            } catch {
                // Ignore exit errors
            }
        };

        const removeGate = () => {
            const existing = document.getElementById(GATE_ID);
            if (existing) existing.remove();
        };

        const showGate = () => {
            if (document.getElementById(GATE_ID)) return;
            removeLegacyInlineStyles();

            const gate = document.createElement('div');
            gate.id = GATE_ID;

            gate.innerHTML = `
                <div class="loc-fs-card">
                    <span class="loc-fs-corner tl" aria-hidden="true"></span>
                    <span class="loc-fs-corner tr" aria-hidden="true"></span>
                    <span class="loc-fs-corner bl" aria-hidden="true"></span>
                    <span class="loc-fs-corner br" aria-hidden="true"></span>

                    <div class="loc-fs-divider" aria-hidden="true">
                        <span class="loc-fs-bracket">
                            <span class="loc-fs-hook left"></span>
                            <span class="loc-fs-dash"></span>
                            <span class="loc-fs-dash"></span>
                        </span>
                        <span class="loc-fs-parallelogram">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square">
                                <polyline points="15 3 21 3 21 9"/>
                                <polyline points="9 21 3 21 3 15"/>
                                <line x1="21" y1="3" x2="14" y2="10"/>
                                <line x1="3" y1="21" x2="10" y2="14"/>
                            </svg>
                            <span>LOCK</span>
                        </span>
                        <span class="loc-fs-bracket">
                            <span class="loc-fs-dash"></span>
                            <span class="loc-fs-dash"></span>
                            <span class="loc-fs-hook right"></span>
                        </span>
                    </div>

                    <div class="loc-fs-title-top">FULLSCREEN</div>
                    <div class="loc-fs-title-sub">
                        <span>REQUIRED</span>
                        <span class="loc-fs-underscore" aria-hidden="true"></span>
                    </div>

                    <p class="loc-fs-desc">
                        The administrator enabled fullscreen lock for active players. Click anywhere or press any key to enter fullscreen.
                    </p>

                    <button type="button" id="${GATE_ID}-btn" class="loc-fs-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" aria-hidden="true">
                            <polyline points="15 3 21 3 21 9"/>
                            <polyline points="9 21 3 21 3 15"/>
                            <line x1="21" y1="3" x2="14" y2="10"/>
                            <line x1="3" y1="21" x2="10" y2="14"/>
                        </svg>
                        <span>Enter Fullscreen</span>
                    </button>
                </div>
            `;

            gate.addEventListener('click', () => {
                enterFullscreen().then((ok) => {
                    if (ok) removeGate();
                });
            });

            document.body.appendChild(gate);
        };

        if (!security.forceFullscreen) {
            removeGate();
            exitFullscreen();
            return undefined;
        }

        let cancelled = false;
        let wasFullscreen = Boolean(getFullscreenElement());

        enterFullscreen().then((ok) => {
            if (cancelled) return;
            if (ok || getFullscreenElement()) {
                wasFullscreen = true;
                removeGate();
            } else {
                showGate();
            }
        });

        const handleUserGesture = () => {
            if (!security.forceFullscreen || getFullscreenElement()) return;
            enterFullscreen().then((ok) => {
                if (!cancelled && (ok || getFullscreenElement())) {
                    wasFullscreen = true;
                    removeGate();
                }
            });
        };

        const handleFullscreenChange = () => {
            if (cancelled) return;
            lastFullscreenTransitionAtRef.current = Date.now();
            const isFs = Boolean(getFullscreenElement());
            if (isFs) {
                wasFullscreen = true;
                removeGate();
            } else if (security.forceFullscreen) {
                if (wasFullscreen) {
                    reportAction({
                        type: 'ALERT',
                        category: 'FULLSCREEN',
                        action: 'fullscreen_exit',
                        message: 'Exited fullscreen mode',
                        blocked: false,
                        cooldownMs: 600
                    });
                    showSecurityAlert();
                }
                wasFullscreen = false;
                showGate();
            }
        };

        document.addEventListener('pointerdown', handleUserGesture, true);
        document.addEventListener('keydown', handleUserGesture, true);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

        return () => {
            cancelled = true;
            document.removeEventListener('pointerdown', handleUserGesture, true);
            document.removeEventListener('keydown', handleUserGesture, true);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            removeGate();
        };
    }, [passive, security.forceFullscreen, reportAction, showSecurityAlert]);

    // Enforce Admin "Block DevTools / Inspect" & "Block AI / Side Panel" policies in real time
    useEffect(() => {
        if (passive) return undefined;

        const DEVTOOLS_GATE_ID = 'security-devtools-gate';
        const AI_GATE_ID = 'security-ai-gate';
        const FOCUS_SHIELD_ID = 'security-focus-shield';

        const removeById = (id) => {
            const el = document.getElementById(id);
            if (el) el.remove();
        };

        if (!security.blockDevTools && !security.blockAiAssistant) {
            removeById(DEVTOOLS_GATE_ID);
            removeById(AI_GATE_ID);
            removeById(FOCUS_SHIELD_ID);
            return undefined;
        }

        let devToolsReported = false;
        let sidePanelReported = false;
        const baseDpr = window.devicePixelRatio || 1;
        const baseDiffW = Math.max(0, window.outerWidth - window.innerWidth);
        const baseDiffH = Math.max(0, window.outerHeight - window.innerHeight);

        const showGateOverlay = (id, config) => {
            if (document.getElementById(id)) return;
            removeLegacyInlineStyles();
            const gate = document.createElement('div');
            gate.id = id;
            gate.innerHTML = buildLockGateHtml(config);
            if (id === FOCUS_SHIELD_ID) {
                gate.addEventListener('click', () => {
                    window.focus();
                    if (Date.now() < transientShieldUntilRef.current) return;
                    if (document.hasFocus()) removeById(FOCUS_SHIELD_ID);
                });
            }
            document.body.appendChild(gate);
        };

        const handleContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            reportAction({
                type: 'ALERT',
                category: 'CONTEXT_MENU',
                action: 'contextmenu',
                message: 'Blocked right-click context menu (Inspect / Ask Gemini)',
                blocked: true,
                cooldownMs: 450
            });
            showSecurityAlert();
        };

        const syncFocusShield = () => {
            if (Date.now() < transientShieldUntilRef.current) {
                showGateOverlay(FOCUS_SHIELD_ID, {
                    badge: 'LOCKED',
                    titleTop: 'SECURITY',
                    titleSub: 'LOCKED',
                    desc: 'Security integrity verification is active. Keep focus on the arena and wait a moment to resume.'
                });
                return;
            }
            if (!security.blockAiAssistant) {
                removeById(FOCUS_SHIELD_ID);
                return;
            }
            if (Date.now() - lastFullscreenTransitionAtRef.current < 800) {
                return;
            }
            if (!document.hasFocus() || document.visibilityState === 'hidden') {
                showGateOverlay(FOCUS_SHIELD_ID, {
                    badge: 'LOCKED',
                    titleTop: 'SECURITY',
                    titleSub: 'LOCKED',
                    desc: 'Security integrity verification is active. Keep focus on the arena and wait a moment to resume.'
                });
            } else {
                removeById(FOCUS_SHIELD_ID);
            }
        };

        const probePanels = () => {
            const sameZoom = Math.abs((window.devicePixelRatio || 1) - baseDpr) < 0.05;
            const curDiffW = Math.max(0, window.outerWidth - window.innerWidth);
            const curDiffH = Math.max(0, window.outerHeight - window.innerHeight);
            const widthDelta = curDiffW - baseDiffW;
            const heightDelta = curDiffH - baseDiffH;

            let debuggerTriggered = false;
            if (security.blockDevTools) {
                try {
                    const start = performance.now();
                    (function () {}).constructor('debugger')();
                    debuggerTriggered = (performance.now() - start) > 120;
                } catch {
                    // Ignore CSP-restricted Function constructor environments
                }
            }

            const dockedDevTools = security.blockDevTools && sameZoom && (heightDelta > 150 || (!security.blockAiAssistant && widthDelta > 150));
            const isDevToolsOpen = debuggerTriggered || dockedDevTools;
            const isSidePanelOpen = security.blockAiAssistant && sameZoom && widthDelta > 130 && !isDevToolsOpen;

            if (isDevToolsOpen) {
                removeById(AI_GATE_ID);
                showGateOverlay(DEVTOOLS_GATE_ID, {
                    badge: 'RESTRICTED',
                    titleTop: 'SECURITY',
                    titleSub: 'LOCKED',
                    desc: 'A security policy violation was detected in your browser environment. Restore standard arena view to resume.'
                });
                if (!devToolsReported) {
                    devToolsReported = true;
                    const method = debuggerTriggered && dockedDevTools
                        ? 'docked + debugger'
                        : debuggerTriggered
                            ? 'debugger'
                            : 'docked viewport';
                    reportAction({
                        type: 'ALERT',
                        category: 'DEVTOOLS',
                        action: 'devtools_open',
                        message: `DevTools opened while restricted (${method})`,
                        blocked: true,
                        cooldownMs: 1200
                    });
                    showSecurityAlert();
                }
            } else {
                if (devToolsReported) {
                    reportAction({
                        type: 'INFO',
                        category: 'DEVTOOLS',
                        action: 'devtools_closed',
                        message: 'DevTools closed; player arena resumed',
                        blocked: false,
                        cooldownMs: 1000
                    });
                }
                devToolsReported = false;
                removeById(DEVTOOLS_GATE_ID);
            }

            if (isSidePanelOpen) {
                showGateOverlay(AI_GATE_ID, {
                    badge: 'RESTRICTED',
                    titleTop: 'SECURITY',
                    titleSub: 'LOCKED',
                    desc: 'A security policy violation was detected in your browser environment. Restore standard arena view to resume.'
                });
                if (!sidePanelReported) {
                    sidePanelReported = true;
                    reportAction({
                        type: 'ALERT',
                        category: 'AI_ASSISTANT',
                        action: 'side_panel_open',
                        message: 'Browser side panel / Ask Gemini sidebar opened while restricted',
                        blocked: true,
                        cooldownMs: 1200
                    });
                    showSecurityAlert();
                }
            } else {
                if (sidePanelReported) {
                    reportAction({
                        type: 'INFO',
                        category: 'AI_ASSISTANT',
                        action: 'side_panel_closed',
                        message: 'Browser side panel closed; player arena resumed',
                        blocked: false,
                        cooldownMs: 1000
                    });
                }
                sidePanelReported = false;
                removeById(AI_GATE_ID);
            }

            syncFocusShield();
        };

        window.addEventListener('contextmenu', handleContextMenu, true);
        window.addEventListener('resize', probePanels);
        window.addEventListener('blur', syncFocusShield);
        window.addEventListener('focus', syncFocusShield);
        document.addEventListener('visibilitychange', syncFocusShield);
        const probeInterval = setInterval(probePanels, 1000);
        probePanels();

        return () => {
            window.removeEventListener('contextmenu', handleContextMenu, true);
            window.removeEventListener('resize', probePanels);
            window.removeEventListener('blur', syncFocusShield);
            window.removeEventListener('focus', syncFocusShield);
            document.removeEventListener('visibilitychange', syncFocusShield);
            clearInterval(probeInterval);
            removeById(DEVTOOLS_GATE_ID);
            removeById(AI_GATE_ID);
            removeById(FOCUS_SHIELD_ID);
        };
    }, [passive, security.blockDevTools, security.blockAiAssistant, reportAction, showSecurityAlert]);

    return { security, reportAction };
};

export default useSecurity;
