import { useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import "./StudyPlanPage.css";

const focusOptions = ["Summary", "Quiz", "Ask PDF", "Revision", "Mixed"];

export default function StudyPlanPage() {
    const [notes, setNotes] = useState([]);
    const [selectedNoteIds, setSelectedNoteIds] = useState([]);

    const [examDate, setExamDate] = useState("2026-06-20");
    const [hoursPerDay, setHoursPerDay] = useState(3);
    const [studyDays, setStudyDays] = useState(5);
    const [difficulty, setDifficulty] = useState("Medium");
    const [focusMode, setFocusMode] = useState("Mixed");

    const [plan, setPlan] = useState([]);
    const [overview, setOverview] = useState(null);

    const [notesLoading, setNotesLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [notesDropdownOpen, setNotesDropdownOpen] = useState(false);
    const notesDropdownRef = useRef(null);

    const totalHours = Number(hoursPerDay || 0) * Number(studyDays || 0);

    const totalTasks = useMemo(() => {
        return plan.reduce((sum, day) => {
            return sum + (Array.isArray(day.tasks) ? day.tasks.length : 0);
        }, 0);
    }, [plan]);

    const getNoteTitle = (note) => {
        return (
            note.title ||
            note.name ||
            note.file_name ||
            note.filename ||
            note.original_name ||
            note.pdf_title ||
            `Note #${note.id}`
        );
    };

    const selectedNotesText =
        selectedNoteIds.length === 0
            ? "Select notes"
            : selectedNoteIds.length === 1
            ? "1 note selected"
            : `${selectedNoteIds.length} notes selected`;

    const toggleNoteSelection = (noteId) => {
        setSelectedNoteIds((prev) => {
            if (prev.includes(noteId)) {
                return prev.filter((id) => id !== noteId);
            }

            return [...prev, noteId];
        });
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (
                notesDropdownRef.current &&
                !notesDropdownRef.current.contains(event.target)
            ) {
                setNotesDropdownOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    useEffect(() => {
        const fetchNotes = async () => {
            setNotesLoading(true);
            setError("");

            try {
                const response = await axiosClient.get("/notes");

                const raw = response.data;
                let notesList = [];

                if (Array.isArray(raw)) {
                    notesList = raw;
                } else if (Array.isArray(raw?.data)) {
                    notesList = raw.data;
                } else if (Array.isArray(raw?.data?.data)) {
                    notesList = raw.data.data;
                }

                setNotes(notesList);

                if (notesList.length > 0) {
                    setSelectedNoteIds([Number(notesList[0].id)]);
                }
            } catch (err) {
                setError("Failed to load your notes.");
            } finally {
                setNotesLoading(false);
            }
        };

        fetchNotes();
    }, []);

    const generateStudyPlan = async () => {
        if (selectedNoteIds.length === 0) {
            setError("Please select at least one note.");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const response = await axiosClient.post("/study-plan/generate", {
                note_ids: selectedNoteIds,
                exam_date: examDate,
                hours_per_day: Number(hoursPerDay),
                study_days: Number(studyDays),
                difficulty,
                focus_mode: focusMode,
            });

            setPlan(response.data.plan || []);
            setOverview(response.data.overview || null);
        } catch (err) {
            setError(
                err?.response?.data?.message ||
                    "Failed to generate study plan."
            );
        } finally {
            setLoading(false);
        }
    };

    const exportStudyPlan = () => {
        if (!plan || plan.length === 0) {
            setError("Generate a study plan first before exporting.");
            return;
        }

        const selectedNoteNames = notes
            .filter((note) => selectedNoteIds.includes(Number(note.id)))
            .map((note) => getNoteTitle(note))
            .join(", ");

        const content = [
            "StudyFlow - AI Study Plan",
            "==========================",
            "",
            `Selected Notes: ${selectedNoteNames || "Selected notes"}`,
            `Exam Date: ${examDate}`,
            `Hours Per Day: ${hoursPerDay}`,
            `Study Days: ${studyDays}`,
            `Difficulty: ${difficulty}`,
            `Focus Mode: ${focusMode}`,
            "",
            "Your Study Plan",
            "---------------",
            "",
            ...plan.flatMap((day, index) => [
                `${day.title || `Day ${index + 1}`}${
                    day.focus ? ` - ${day.focus}` : ""
                }`,
                `Hours: ${day.hours || hoursPerDay}`,
                ...(day.tasks || []).map(
                    (task, taskIndex) => `${taskIndex + 1}. ${task}`
                ),
                "",
            ]),
        ].join("\n");

        const blob = new Blob([content], {
            type: "text/plain;charset=utf-8",
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "study-plan.txt";
        document.body.appendChild(link);
        link.click();

        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="study-plan-page">
            <div className="study-plan-header">
                <div>
                    <h1>Plan of Study</h1>
                    <p>
                        Create an AI-powered study plan using your saved notes,
                        summaries, quiz practice, and revision goals.
                    </p>
                </div>
            </div>

            {error && <div className="study-plan-error">{error}</div>}

            <div className="study-plan-grid">
                <section className="study-plan-card">
                    <h2>Plan Settings</h2>

                    <div className="study-plan-field" ref={notesDropdownRef}>
                        <label>Select Notes / PDFs</label>

                        <button
                            type="button"
                            className="study-plan-notes-button"
                            onClick={() =>
                                setNotesDropdownOpen((prev) => !prev)
                            }
                        >
                            <span>{selectedNotesText}</span>
                            <span>{notesDropdownOpen ? "▴" : "▾"}</span>
                        </button>

                        {notesDropdownOpen && (
                            <div className="study-plan-notes-menu">
                                {notesLoading && (
                                    <div className="study-plan-note-empty">
                                        Loading your saved notes...
                                    </div>
                                )}

                                {!notesLoading && notes.length === 0 && (
                                    <div className="study-plan-note-empty">
                                        No saved notes found.
                                    </div>
                                )}

                                {!notesLoading &&
                                    notes.map((note) => {
                                        const noteId = Number(note.id);
                                        const isSelected =
                                            selectedNoteIds.includes(noteId);

                                        return (
                                            <label
                                                key={note.id}
                                                className={`study-plan-note-option ${
                                                    isSelected ? "selected" : ""
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() =>
                                                        toggleNoteSelection(
                                                            noteId
                                                        )
                                                    }
                                                />

                                                <span>{getNoteTitle(note)}</span>
                                            </label>
                                        );
                                    })}
                            </div>
                        )}

                        <small className="study-plan-help">
                            Select one or more saved notes to generate your
                            study plan.
                        </small>
                    </div>

                    <div className="study-plan-field">
                        <label>Exam Date</label>
                        <input
                            type="date"
                            value={examDate}
                            onChange={(e) => setExamDate(e.target.value)}
                        />
                    </div>

                    <div className="study-plan-row">
                        <div className="study-plan-field">
                            <label>Hours Per Day</label>
                            <input
                                type="number"
                                min="1"
                                max="12"
                                value={hoursPerDay}
                                onChange={(e) => setHoursPerDay(e.target.value)}
                            />
                        </div>

                        <div className="study-plan-field">
                            <label>Study Days</label>
                            <input
                                type="number"
                                min="1"
                                max="30"
                                value={studyDays}
                                onChange={(e) => setStudyDays(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="study-plan-field">
                        <label>Difficulty Level</label>
                        <select
                            value={difficulty}
                            onChange={(e) => setDifficulty(e.target.value)}
                        >
                            <option>Easy</option>
                            <option>Medium</option>
                            <option>Hard</option>
                        </select>
                    </div>

                    <div className="study-plan-field">
                        <label>Focus Mode</label>

                        <div className="study-plan-focus">
                            {focusOptions.map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    className={
                                        focusMode === option ? "active" : ""
                                    }
                                    onClick={() => setFocusMode(option)}
                                >
                                    {option}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        type="button"
                        className="study-plan-main-btn"
                        onClick={generateStudyPlan}
                        disabled={loading || notesLoading}
                    >
                        {loading
                            ? "Generating with AI..."
                            : "Generate Study Plan"}
                    </button>
                </section>

                <section className="study-plan-card">
                    <h2>Plan Overview</h2>

                    <div className="study-plan-overview">
                        <p>
                            Selected notes:{" "}
                            <strong>{selectedNoteIds.length}</strong>
                        </p>

                        <p>
                            Exam date: <strong>{examDate}</strong>
                        </p>

                        <p>
                            {hoursPerDay} hours/day • {difficulty} difficulty •
                            Focus: {focusMode}
                        </p>

                        {overview?.note_title && (
                            <p>
                                AI plan for:{" "}
                                <strong>{overview.note_title}</strong>
                            </p>
                        )}
                    </div>

                    <div className="study-plan-stats">
                        <div>
                            <strong>
                                {overview?.total_hours || totalHours}
                            </strong>
                            <span>Total Hours</span>
                        </div>

                        <div>
                            <strong>
                                {overview?.study_days || studyDays}
                            </strong>
                            <span>Study Days</span>
                        </div>

                        <div>
                            <strong>{totalTasks}</strong>
                            <span>Tasks</span>
                        </div>
                    </div>

                    <div className="study-plan-goals">
                        <h3>Main Goals</h3>
                        <ul>
                            <li>Use your saved notes as the study source</li>
                            <li>Review summaries and important concepts</li>
                            <li>Practice quizzes and revise weak topics</li>
                        </ul>
                    </div>
                </section>
            </div>

            <section className="study-plan-card study-plan-result">
                <div className="study-plan-result-header">
                    <h2>Your AI Study Plan</h2>

                    <button
                        type="button"
                        onClick={exportStudyPlan}
                        disabled={plan.length === 0}
                    >
                        Export Plan
                    </button>
                </div>

                {plan.length === 0 ? (
                    <div className="study-plan-empty">
                        Select your notes and click Generate Study Plan.
                    </div>
                ) : (
                    <div className="study-plan-days">
                        {plan.map((day, index) => (
                            <article
                                className="study-plan-day-card"
                                key={day.day || index}
                            >
                                <div className="study-plan-day-title">
                                    <span>{day.day || index + 1}</span>
                                    <div>
                                        <h3>
                                            {day.title || `Day ${index + 1}`}
                                        </h3>
                                        {day.focus && <small>{day.focus}</small>}
                                    </div>
                                </div>

                                <ul>
                                    {(day.tasks || []).map(
                                        (task, taskIndex) => (
                                            <li key={taskIndex}>{task}</li>
                                        )
                                    )}
                                </ul>

                                <p>{day.hours || hoursPerDay} hours</p>
                            </article>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}