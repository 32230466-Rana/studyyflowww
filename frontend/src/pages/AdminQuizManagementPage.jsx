import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function AdminQuizManagementPage() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [editingQuiz, setEditingQuiz] = useState(null);

  const [quizzes, setQuizzes] = useState([
    {
      id: 1,
      question: "What is the main purpose of a Use Case Diagram?",
      type: "MCQ",
      difficulty: "Medium",
      correctAnswer: "B",
      status: "Approved",
      options: {
        A: "To design database tables",
        B: "To show user-system interactions",
        C: "To write frontend code",
        D: "To test server speed",
      },
    },
    {
      id: 2,
      question: "A primary actor directly interacts with the system.",
      type: "True/False",
      difficulty: "Hard",
      correctAnswer: "True",
      status: "Pending",
      options: {
        A: "True",
        B: "False",
        C: "",
        D: "",
      },
    },
    {
      id: 3,
      question: "Which relationship is used to reduce repeated behavior?",
      type: "MCQ",
      difficulty: "Hard",
      correctAnswer: "A",
      status: "Rejected",
      options: {
        A: "Include",
        B: "Random",
        C: "Storage",
        D: "Compile",
      },
    },
  ]);

  const filteredQuizzes = useMemo(() => {
    return quizzes.filter((quiz) =>
      quiz.question.toLowerCase().includes(search.toLowerCase())
    );
  }, [quizzes, search]);

  const stats = useMemo(() => {
    return {
      total: quizzes.length,
      approved: quizzes.filter((q) => q.status === "Approved").length,
      pending: quizzes.filter((q) => q.status === "Pending").length,
      rejected: quizzes.filter((q) => q.status === "Rejected").length,
    };
  }, [quizzes]);

  function handleDelete(id) {
    const confirmDelete = window.confirm("Are you sure you want to delete this quiz?");
    if (!confirmDelete) return;

    setQuizzes((prev) => prev.filter((quiz) => quiz.id !== id));
  }

  function handleApprove(id) {
    setQuizzes((prev) =>
      prev.map((quiz) =>
        quiz.id === id ? { ...quiz, status: "Approved" } : quiz
      )
    );
  }

  function handleRegenerate(id) {
    setQuizzes((prev) =>
      prev.map((quiz) =>
        quiz.id === id
          ? {
              ...quiz,
              question: quiz.question + " (Regenerated)",
              status: "Pending",
            }
          : quiz
      )
    );

    alert("Quiz regenerated successfully.");
  }

  function handleEditSave(e) {
    e.preventDefault();

    setQuizzes((prev) =>
      prev.map((quiz) => (quiz.id === editingQuiz.id ? editingQuiz : quiz))
    );

    setEditingQuiz(null);
  }

  function handleGenerateNewQuiz(e) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);

    const newQuiz = {
      id: Date.now(),
      question: form.get("question"),
      type: form.get("type"),
      difficulty: form.get("difficulty"),
      correctAnswer: form.get("correctAnswer"),
      status: "Pending",
      options: {
        A: form.get("optionA"),
        B: form.get("optionB"),
        C: form.get("optionC"),
        D: form.get("optionD"),
      },
    };

    setQuizzes((prev) => [newQuiz, ...prev]);
    e.currentTarget.reset();
    setActiveTab("all");
  }

  return (
    <div style={styles.page}>
      <button onClick={() => navigate("/admin")} style={styles.backButton}>
        ← Back to Admin Dashboard
      </button>

      <div style={styles.header}>
        <div>
          <p style={styles.label}>Admin Panel</p>
          <h1 style={styles.title}>Quiz Management</h1>
          <p style={styles.subtitle}>
            View, edit, approve, delete, and regenerate AI-generated quizzes.
          </p>
        </div>

        <div style={styles.iconBox}>✓</div>
      </div>

      <div style={styles.statsGrid}>
        <StatCard title="Total Quizzes" value={stats.total} />
        <StatCard title="Approved" value={stats.approved} />
        <StatCard title="Pending" value={stats.pending} />
        <StatCard title="Rejected" value={stats.rejected} />
      </div>

      <div style={styles.card}>
        <div style={styles.tabs}>
          <button
            onClick={() => setActiveTab("all")}
            style={{
              ...styles.tabButton,
              ...(activeTab === "all" ? styles.activeTab : {}),
            }}
          >
            View / Edit Quizzes
          </button>

          <button
            onClick={() => setActiveTab("regenerate")}
            style={{
              ...styles.tabButton,
              ...(activeTab === "regenerate" ? styles.activeTab : {}),
            }}
          >
            Regenerate / Add Quiz
          </button>
        </div>

        {activeTab === "all" && (
          <>
            <div style={styles.searchRow}>
              <input
                type="text"
                placeholder="Search quiz question..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={styles.searchInput}
              />
            </div>

            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Question</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Difficulty</th>
                    <th style={styles.th}>Correct</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredQuizzes.map((quiz) => (
                    <tr key={quiz.id}>
                      <td style={styles.td}>{quiz.question}</td>
                      <td style={styles.td}>{quiz.type}</td>
                      <td style={styles.td}>{quiz.difficulty}</td>
                      <td style={styles.td}>{quiz.correctAnswer}</td>
                      <td style={styles.td}>
                        <span style={getStatusStyle(quiz.status)}>
                          {quiz.status}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actions}>
                          <button
                            onClick={() => setEditingQuiz(quiz)}
                            style={styles.editBtn}
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => handleApprove(quiz.id)}
                            style={styles.approveBtn}
                          >
                            Approve
                          </button>

                          <button
                            onClick={() => handleRegenerate(quiz.id)}
                            style={styles.regenBtn}
                          >
                            Regenerate
                          </button>

                          <button
                            onClick={() => handleDelete(quiz.id)}
                            style={styles.deleteBtn}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredQuizzes.length === 0 && (
                <p style={styles.empty}>No quizzes found.</p>
              )}
            </div>
          </>
        )}

        {activeTab === "regenerate" && (
          <form onSubmit={handleGenerateNewQuiz} style={styles.form}>
            <h2 style={styles.formTitle}>Add / Regenerate Quiz Manually</h2>

            <label style={styles.inputGroup}>
              Question
              <textarea
                name="question"
                required
                placeholder="Write quiz question..."
                style={styles.textarea}
              />
            </label>

            <div style={styles.formGrid}>
              <label style={styles.inputGroup}>
                Type
                <select name="type" style={styles.input}>
                  <option>MCQ</option>
                  <option>True/False</option>
                  <option>Subjective</option>
                  <option>Fill in the Blank</option>
                </select>
              </label>

              <label style={styles.inputGroup}>
                Difficulty
                <select name="difficulty" style={styles.input}>
                  <option>Medium</option>
                  <option>Hard</option>
                </select>
              </label>

              <label style={styles.inputGroup}>
                Correct Answer
                <select name="correctAnswer" style={styles.input}>
                  <option>A</option>
                  <option>B</option>
                  <option>C</option>
                  <option>D</option>
                  <option>True</option>
                  <option>False</option>
                </select>
              </label>
            </div>

            <div style={styles.formGrid}>
              <input name="optionA" placeholder="Option A" style={styles.input} />
              <input name="optionB" placeholder="Option B" style={styles.input} />
              <input name="optionC" placeholder="Option C" style={styles.input} />
              <input name="optionD" placeholder="Option D" style={styles.input} />
            </div>

            <button type="submit" style={styles.saveBtn}>
              Save Quiz
            </button>
          </form>
        )}
      </div>

      {editingQuiz && (
        <div style={styles.modalOverlay}>
          <form onSubmit={handleEditSave} style={styles.modal}>
            <h2 style={styles.formTitle}>Edit Quiz</h2>

            <label style={styles.inputGroup}>
              Question
              <textarea
                value={editingQuiz.question}
                onChange={(e) =>
                  setEditingQuiz({ ...editingQuiz, question: e.target.value })
                }
                style={styles.textarea}
              />
            </label>

            <div style={styles.formGrid}>
              <label style={styles.inputGroup}>
                Type
                <select
                  value={editingQuiz.type}
                  onChange={(e) =>
                    setEditingQuiz({ ...editingQuiz, type: e.target.value })
                  }
                  style={styles.input}
                >
                  <option>MCQ</option>
                  <option>True/False</option>
                  <option>Subjective</option>
                  <option>Fill in the Blank</option>
                </select>
              </label>

              <label style={styles.inputGroup}>
                Difficulty
                <select
                  value={editingQuiz.difficulty}
                  onChange={(e) =>
                    setEditingQuiz({
                      ...editingQuiz,
                      difficulty: e.target.value,
                    })
                  }
                  style={styles.input}
                >
                  <option>Medium</option>
                  <option>Hard</option>
                </select>
              </label>

              <label style={styles.inputGroup}>
                Correct Answer
                <input
                  value={editingQuiz.correctAnswer}
                  onChange={(e) =>
                    setEditingQuiz({
                      ...editingQuiz,
                      correctAnswer: e.target.value,
                    })
                  }
                  style={styles.input}
                />
              </label>
            </div>

            <div style={styles.modalActions}>
              <button type="submit" style={styles.saveBtn}>
                Save Changes
              </button>

              <button
                type="button"
                onClick={() => setEditingQuiz(null)}
                style={styles.cancelBtn}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <div style={styles.statCard}>
      <p style={styles.statTitle}>{title}</p>
      <h3 style={styles.statValue}>{value}</h3>
    </div>
  );
}

function getStatusStyle(status) {
  if (status === "Approved") {
    return { ...styles.status, background: "#dcfce7", color: "#166534" };
  }

  if (status === "Rejected") {
    return { ...styles.status, background: "#fee2e2", color: "#991b1b" };
  }

  return { ...styles.status, background: "#fef3c7", color: "#92400e" };
}

const styles = {
  page: {
    minHeight: "100vh",
    padding: "32px",
    background: "linear-gradient(135deg, #eef6ff 0%, #f8fbff 100%)",
    fontFamily: "Arial, sans-serif",
  },

  backButton: {
    border: "0",
    background: "#ffffff",
    color: "#164b8f",
    padding: "12px 18px",
    borderRadius: "14px",
    fontWeight: "800",
    cursor: "pointer",
    marginBottom: "18px",
    boxShadow: "0 8px 22px rgba(15, 23, 42, 0.08)",
  },

  header: {
    background: "#ffffff",
    borderRadius: "28px",
    padding: "28px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxShadow: "0 16px 38px rgba(15, 23, 42, 0.08)",
    marginBottom: "22px",
  },

  label: {
    margin: "0 0 8px",
    color: "#f4b000",
    fontWeight: "900",
    letterSpacing: "0.5px",
  },

  title: {
    margin: 0,
    color: "#0b3d86",
    fontSize: "34px",
  },

  subtitle: {
    margin: "10px 0 0",
    color: "#64748b",
    fontWeight: "600",
  },

  iconBox: {
    width: "64px",
    height: "64px",
    borderRadius: "20px",
    background: "#eaf3ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#22c55e",
    fontSize: "36px",
    fontWeight: "900",
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "16px",
    marginBottom: "22px",
  },

  statCard: {
    background: "#ffffff",
    borderRadius: "22px",
    padding: "20px",
    boxShadow: "0 14px 32px rgba(15, 23, 42, 0.07)",
  },

  statTitle: {
    margin: 0,
    color: "#64748b",
    fontWeight: "800",
  },

  statValue: {
    margin: "10px 0 0",
    color: "#0b3d86",
    fontSize: "30px",
  },

  card: {
    background: "#ffffff",
    borderRadius: "28px",
    padding: "24px",
    boxShadow: "0 16px 38px rgba(15, 23, 42, 0.08)",
  },

  tabs: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "18px",
  },

  tabButton: {
    border: "0",
    padding: "12px 18px",
    borderRadius: "14px",
    background: "#eef4ff",
    color: "#0b3d86",
    fontWeight: "900",
    cursor: "pointer",
  },

  activeTab: {
    background: "#0b3d86",
    color: "#ffffff",
  },

  searchRow: {
    marginBottom: "16px",
  },

  searchInput: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid #dbeafe",
    outline: "none",
    fontWeight: "700",
  },

  tableWrapper: {
    width: "100%",
    overflowX: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "900px",
  },

  th: {
    textAlign: "left",
    padding: "14px",
    background: "#f1f7ff",
    color: "#0b3d86",
    fontSize: "14px",
  },

  td: {
    padding: "14px",
    borderBottom: "1px solid #edf2f7",
    color: "#1e293b",
    fontWeight: "600",
    verticalAlign: "top",
  },

  status: {
    padding: "7px 12px",
    borderRadius: "999px",
    fontWeight: "900",
    fontSize: "13px",
    display: "inline-block",
  },

  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },

  editBtn: {
    border: "0",
    borderRadius: "10px",
    padding: "9px 12px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontWeight: "900",
    cursor: "pointer",
  },

  approveBtn: {
    border: "0",
    borderRadius: "10px",
    padding: "9px 12px",
    background: "#dcfce7",
    color: "#166534",
    fontWeight: "900",
    cursor: "pointer",
  },

  regenBtn: {
    border: "0",
    borderRadius: "10px",
    padding: "9px 12px",
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: "900",
    cursor: "pointer",
  },

  deleteBtn: {
    border: "0",
    borderRadius: "10px",
    padding: "9px 12px",
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: "900",
    cursor: "pointer",
  },

  empty: {
    textAlign: "center",
    color: "#64748b",
    fontWeight: "800",
    padding: "24px",
  },

  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },

  formTitle: {
    margin: "0 0 6px",
    color: "#0b3d86",
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "14px",
  },

  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    color: "#0b3d86",
    fontWeight: "900",
  },

  input: {
    padding: "13px 14px",
    borderRadius: "14px",
    border: "1px solid #dbeafe",
    outline: "none",
    fontWeight: "700",
  },

  textarea: {
    minHeight: "110px",
    padding: "13px 14px",
    borderRadius: "14px",
    border: "1px solid #dbeafe",
    outline: "none",
    resize: "vertical",
    fontWeight: "700",
  },

  saveBtn: {
    border: "0",
    borderRadius: "14px",
    padding: "13px 18px",
    background: "#0b3d86",
    color: "#ffffff",
    fontWeight: "900",
    cursor: "pointer",
    width: "fit-content",
  },

  cancelBtn: {
    border: "0",
    borderRadius: "14px",
    padding: "13px 18px",
    background: "#e2e8f0",
    color: "#334155",
    fontWeight: "900",
    cursor: "pointer",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    zIndex: 999,
  },

  modal: {
    width: "min(760px, 100%)",
    background: "#ffffff",
    borderRadius: "24px",
    padding: "24px",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.25)",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },

  modalActions: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
  },
};