import React, { useState, useEffect, useRef } from 'react';
import Editor from "@monaco-editor/react";
import useSecurity from '../../hooks/useSecurity';

const DEADLOCK_LANGUAGES = [
    { value: 'python', label: 'Python 3', tag: 'py3' },
    { value: 'cpp', label: 'C++ (GCC 17)', tag: 'c++17' },
    { value: 'java', label: 'Java 17', tag: 'jdk17' },
];

const normalizeCode = (val) => (typeof val === 'string' ? val.replace(/\r\n/g, '\n') : '');

const CodePanel = React.memo(({ code, setCode, language, setLanguage, isLocked, onSubmitShortcut, security: securityProp }) => {
    const editorRef = useRef(null);
    const teamName = localStorage.getItem('teamName') || 'UNKNOWN';
    const { security: fallbackSecurity } = useSecurity(teamName, { passive: Boolean(securityProp) });
    const security = securityProp || fallbackSecurity;

    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(() =>
        Math.max(0, DEADLOCK_LANGUAGES.findIndex((opt) => opt.value === language))
    );
    const dropdownRef = useRef(null);
    const triggerRef = useRef(null);

    // Always invoke the latest submit callback and lock state from Monaco's command handler
    const onSubmitShortcutRef = useRef(onSubmitShortcut);
    const isLockedRef = useRef(isLocked);

    useEffect(() => {
        onSubmitShortcutRef.current = onSubmitShortcut;
        isLockedRef.current = isLocked;
    }, [onSubmitShortcut, isLocked]);

    useEffect(() => {
        if (!dropdownOpen) return;
        const handleOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [dropdownOpen]);

    const selectedOption = DEADLOCK_LANGUAGES.find((opt) => opt.value === language) || DEADLOCK_LANGUAGES[0];

    const toggleDropdown = () => {
        if (isLocked) return;
        setDropdownOpen((prev) => {
            const next = !prev;
            if (next) {
                const idx = DEADLOCK_LANGUAGES.findIndex((opt) => opt.value === language);
                setHighlightedIndex(idx >= 0 ? idx : 0);
            }
            return next;
        });
    };

    const selectLanguage = (nextVal) => {
        setLanguage(nextVal);
        setDropdownOpen(false);
        triggerRef.current?.focus();
    };

    const handleDropdownKeyDown = (event) => {
        if (isLocked) return;
        if (!dropdownOpen) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                event.preventDefault();
                const idx = DEADLOCK_LANGUAGES.findIndex((opt) => opt.value === language);
                setHighlightedIndex(idx >= 0 ? idx : 0);
                setDropdownOpen(true);
            }
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setDropdownOpen(false);
            triggerRef.current?.focus();
        } else if (event.key === 'Tab') {
            setDropdownOpen(false);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlightedIndex((prev) => (prev + 1) % DEADLOCK_LANGUAGES.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlightedIndex((prev) => (prev - 1 + DEADLOCK_LANGUAGES.length) % DEADLOCK_LANGUAGES.length);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const picked = DEADLOCK_LANGUAGES[highlightedIndex];
            if (picked) selectLanguage(picked.value);
        }
    };

    const handlePaste = (e) => {
        if (security.disableCopyPaste) {
            e.preventDefault();
        }
    };

    const handleEditorDidMount = (editor, monaco) => {
        editorRef.current = editor;
        // Register Ctrl+Enter and Cmd+Enter shortcut directly within Monaco editor
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            if (onSubmitShortcutRef.current && !isLockedRef.current) {
                onSubmitShortcutRef.current();
            }
        });
    };

    // Safely sync code ONLY when it genuinely changes externally (language switch / question template change)
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const normalizedIncoming = normalizeCode(code);
        const currentModelVal = normalizeCode(editor.getValue());

        // If the editor already holds this text (e.g. from active typing), NEVER call setValue to prevent cursor jumping!
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

    const editorOptions = React.useMemo(() => ({
        readOnly: isLocked,
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        lineNumbersMinChars: 3,
        contextmenu: !security?.disableCopyPaste && !security?.disableTextSelection && !security?.blockDevTools && !security?.blockAiAssistant,
        copySelection: !security?.disableCopyPaste,
        links: false,
        dragAndDrop: false,
        selectionClipboard: false,
        automaticLayout: true,
    }), [isLocked, security?.disableCopyPaste, security?.disableTextSelection, security?.blockDevTools, security?.blockAiAssistant]);

    return (
        <div className="clean-code-panel">
            {/* Editor Toolbar */}
            <div className="clean-editor-toolbar">
                <div className="toolbar-left">
                    <span className="toolbar-label">Language</span>
                    <div
                        ref={dropdownRef}
                        className={`dl-lang-selector ${dropdownOpen ? 'is-open' : ''}`}
                        onKeyDown={handleDropdownKeyDown}
                    >
                        <button
                            ref={triggerRef}
                            type="button"
                            className="dl-lang-trigger"
                            aria-haspopup="listbox"
                            aria-expanded={dropdownOpen}
                            aria-label="Language selector"
                            disabled={isLocked}
                            onClick={toggleDropdown}
                        >
                            <svg className="dl-lang-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="16 18 22 12 16 6" />
                                <polyline points="8 6 2 12 8 18" />
                            </svg>
                            <span className="dl-lang-label">{selectedOption.label}</span>
                            <svg className="dl-lang-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </button>

                        {dropdownOpen && (
                            <div className="dl-lang-menu" role="listbox" aria-label="Programming languages">
                                {DEADLOCK_LANGUAGES.map((opt, idx) => {
                                    const isSelected = opt.value === language;
                                    const isHighlighted = idx === highlightedIndex;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            role="option"
                                            aria-selected={isSelected}
                                            className={`dl-lang-option ${isSelected ? 'is-selected' : ''} ${isHighlighted ? 'is-highlighted' : ''}`}
                                            onMouseEnter={() => setHighlightedIndex(idx)}
                                            onClick={() => selectLanguage(opt.value)}
                                        >
                                            <span className="dl-lang-option-main">
                                                <span className="dl-lang-option-dot" aria-hidden="true" />
                                                <span className="dl-lang-option-label">{opt.label}</span>
                                            </span>
                                            <span className="dl-lang-option-meta">
                                                <span className="dl-lang-option-tag">{opt.tag}</span>
                                                {isSelected && (
                                                    <svg className="dl-lang-option-check" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
                </div>

                <div className="toolbar-right">
                    <div className="clean-integrity-badge" title="Integrity Lock: Anti-cheat security active">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                        <span>Integrity Lock</span>
                    </div>
                    {isLocked && <span className="clean-locked-pill">Locked</span>}
                </div>
            </div>

            {/* Monaco Editor Container */}
            <div className="clean-monaco-wrap" onPaste={handlePaste}>
                <Editor
                    key={language}
                    height="100%"
                    language={language}
                    theme="vs-dark"
                    defaultValue={normalizeCode(code)}
                    onChange={(val) => setCode(normalizeCode(val))}
                    onMount={handleEditorDidMount}
                    options={editorOptions}
                />
            </div>
        </div>
    );
});

export default CodePanel;
