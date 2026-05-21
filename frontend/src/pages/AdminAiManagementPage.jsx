import { Link } from "react-router-dom";

function StatCard({ icon, title, value, subtitle, variant }) {
    return (
        <div className={`ai-admin-stat-card ${variant}`}>
            <div className="ai-admin-stat-icon">{icon}</div>

            <div>
                <strong>{value}</strong>
                <p>{title}</p>
                <span>{subtitle}</span>
            </div>
        </div>
    );
}

function ReportCard({ dotClass, title, text }) {
    return (
        <div className="ai-admin-report-card">
            <span className={`ai-admin-dot ${dotClass}`} />

            <div>
                <h3>{title}</h3>
                <p>{text}</p>
            </div>
        </div>
    );
}

export default function AdminAiManagementPage() {
    return (
        <div className="ai-admin-page">
            <style>{`
                .ai-admin-page {
                    min-height: 100%;
                    padding: 24px;
                    background:
                        radial-gradient(circle at top left, rgba(124, 58, 237, 0.14), transparent 30%),
                        linear-gradient(180deg, #f7fbff 0%, #eef6ff 100%);
                    color: #172033;
                }

                .ai-admin-top {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 16px;
                    margin-bottom: 20px;
                }

                .ai-admin-kicker {
                    margin: 0 0 5px;
                    color: #64748b;
                    font-size: 14px;
                    font-weight: 700;
                }

                .ai-admin-top h1 {
                    margin: 0;
                    font-size: 30px;
                    color: #0f172a;
                    font-weight: 950;
                }

                .ai-admin-back {
                    text-decoration: none;
                    background: #ffffff;
                    color: #1d4ed8;
                    padding: 12px 16px;
                    border-radius: 14px;
                    font-weight: 850;
                    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
                    transition: 0.2s ease;
                }

                .ai-admin-back:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
                }

                .ai-admin-hero {
                    position: relative;
                    overflow: hidden;
                    border-radius: 28px;
                    padding: 30px 24px;
                    margin-bottom: 20px;
                    color: white;
                    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #2563eb 100%);
                    box-shadow: 0 18px 38px rgba(79, 70, 229, 0.25);
                }

                .ai-admin-hero::after {
                    content: "";
                    position: absolute;
                    width: 180px;
                    height: 180px;
                    right: -60px;
                    bottom: -70px;
                    border-radius: 999px;
                    background: rgba(255, 255, 255, 0.16);
                }

                .ai-admin-hero h2 {
                    position: relative;
                    z-index: 2;
                    margin: 0;
                    font-size: clamp(34px, 5vw, 58px);
                    line-height: 1;
                    font-weight: 950;
                    text-transform: uppercase;
                    text-shadow: 0 4px 12px rgba(15, 23, 42, 0.22);
                }

                .ai-admin-hero p {
                    position: relative;
                    z-index: 2;
                    max-width: 720px;
                    margin: 14px 0 0;
                    font-size: 17px;
                    line-height: 1.7;
                    color: rgba(255, 255, 255, 0.92);
                    font-weight: 650;
                }

                .ai-admin-stats-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 16px;
                    margin-bottom: 20px;
                }

                .ai-admin-stat-card {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    background: rgba(255, 255, 255, 0.96);
                    border: 1px solid rgba(148, 163, 184, 0.22);
                    border-radius: 22px;
                    padding: 20px;
                    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
                }

                .ai-admin-stat-icon {
                    display: grid;
                    place-items: center;
                    width: 58px;
                    height: 58px;
                    border-radius: 18px;
                    font-size: 28px;
                    flex: 0 0 auto;
                }

                .ai-admin-stat-card.summary .ai-admin-stat-icon {
                    background: #fef3c7;
                }

                .ai-admin-stat-card.quiz .ai-admin-stat-icon {
                    background: #dcfce7;
                }

                .ai-admin-stat-card.usage .ai-admin-stat-icon {
                    background: #dbeafe;
                }

                .ai-admin-stat-card strong {
                    display: block;
                    font-size: 30px;
                    line-height: 1;
                    color: #0f172a;
                }

                .ai-admin-stat-card p {
                    margin: 7px 0 3px;
                    color: #334155;
                    font-size: 15px;
                    font-weight: 900;
                }

                .ai-admin-stat-card span {
                    color: #64748b;
                    font-size: 13px;
                    font-weight: 700;
                }

                .ai-admin-section {
                    background: rgba(255, 255, 255, 0.96);
                    border: 1px solid rgba(148, 163, 184, 0.22);
                    border-radius: 24px;
                    padding: 22px;
                    box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08);
                    margin-bottom: 20px;
                }

                .ai-admin-section h2 {
                    margin: 0 0 16px;
                    color: #164b8f;
                    font-size: 24px;
                    font-weight: 950;
                }

                .ai-admin-report-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 16px;
                }

                .ai-admin-report-card {
                    display: flex;
                    align-items: flex-start;
                    gap: 13px;
                    padding: 18px;
                    border-radius: 18px;
                    background: #f8fbff;
                    border: 1px solid #dbeafe;
                }

                .ai-admin-dot {
                    width: 13px;
                    height: 13px;
                    border-radius: 999px;
                    margin-top: 7px;
                    flex: 0 0 auto;
                }

                .ai-admin-dot.yellow {
                    background: #fbbf24;
                }

                .ai-admin-dot.green {
                    background: #22c55e;
                }

                .ai-admin-dot.blue {
                    background: #60a5fa;
                }

                .ai-admin-report-card h3 {
                    margin: 0 0 8px;
                    color: #0f172a;
                    font-size: 18px;
                    font-weight: 950;
                }

                .ai-admin-report-card p {
                    margin: 0;
                    color: #64748b;
                    line-height: 1.6;
                    font-size: 14px;
                    font-weight: 650;
                }

                .ai-admin-table {
                    width: 100%;
                    border-collapse: collapse;
                    min-width: 680px;
                }

                .ai-admin-table th {
                    text-align: left;
                    padding: 13px 14px;
                    background: #f1f5f9;
                    color: #475569;
                    font-size: 12px;
                    text-transform: uppercase;
                }

                .ai-admin-table td {
                    padding: 14px;
                    border-top: 1px solid #e2e8f0;
                    color: #334155;
                    font-size: 14px;
                    font-weight: 700;
                }

                .ai-admin-table-wrap {
                    overflow-x: auto;
                    border-radius: 18px;
                    border: 1px solid #e2e8f0;
                }

                .ai-admin-pill {
                    display: inline-flex;
                    padding: 6px 11px;
                    border-radius: 999px;
                    background: #ede9fe;
                    color: #6d28d9;
                    font-weight: 950;
                    font-size: 12px;
                }

                @media (max-width: 980px) {
                    .ai-admin-stats-grid,
                    .ai-admin-report-grid {
                        grid-template-columns: 1fr;
                    }

                    .ai-admin-top {
                        align-items: flex-start;
                        flex-direction: column;
                    }

                    .ai-admin-back {
                        width: 100%;
                        text-align: center;
                    }
                }
            `}</style>

            <div className="ai-admin-top">
                <div>
                    <p className="ai-admin-kicker">Admin control panel</p>
                    <h1>AI Management</h1>
                </div>

                <Link to="/admin" className="ai-admin-back">
                    ← Back to Admin Dashboard
                </Link>
            </div>

            <section className="ai-admin-hero">
                <h2>AI Management</h2>
                <p>
                    Review StudyFlow AI activity, including generated summaries,
                    quiz usage, and AI tool reports in one organized admin page.
                </p>
            </section>

            <section className="ai-admin-stats-grid">
                <StatCard
                    icon="📄"
                    title="Summary Stats"
                    value="0"
                    subtitle="Generated AI summaries"
                    variant="summary"
                />

                <StatCard
                    icon="📝"
                    title="Quiz Stats"
                    value="0"
                    subtitle="Generated quizzes and attempts"
                    variant="quiz"
                />

                <StatCard
                    icon="🤖"
                    title="AI Usage Reports"
                    value="0"
                    subtitle="AI requests across StudyFlow"
                    variant="usage"
                />
            </section>

            <section className="ai-admin-section">
                <h2>AI Reports Overview</h2>

                <div className="ai-admin-report-grid">
                    <ReportCard
                        dotClass="yellow"
                        title="Summary Stats"
                        text="Track how many summaries were generated and review summary activity across study notes."
                    />

                    <ReportCard
                        dotClass="green"
                        title="Quiz Stats"
                        text="Monitor quiz generation, quiz attempts, and student interaction with quiz features."
                    />

                    <ReportCard
                        dotClass="blue"
                        title="AI Usage Reports"
                        text="Review how students use AI tools such as Ask Note, summaries, and local AI features."
                    />
                </div>
            </section>

            <section className="ai-admin-section">
                <h2>Recent AI Activity</h2>

                <div className="ai-admin-table-wrap">
                    <table className="ai-admin-table">
                        <thead>
                            <tr>
                                <th>Feature</th>
                                <th>Description</th>
                                <th>Status</th>
                            </tr>
                        </thead>

                        <tbody>
                            <tr>
                                <td>Summary Stats</td>
                                <td>AI-generated summaries report</td>
                                <td>
                                    <span className="ai-admin-pill">Ready</span>
                                </td>
                            </tr>

                            <tr>
                                <td>Quiz Stats</td>
                                <td>Quiz generation and attempts report</td>
                                <td>
                                    <span className="ai-admin-pill">Ready</span>
                                </td>
                            </tr>

                            <tr>
                                <td>AI Usage Reports</td>
                                <td>AI request tracking and usage overview</td>
                                <td>
                                    <span className="ai-admin-pill">Ready</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}