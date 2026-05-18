import { useEffect, useState } from "react";
import axiosClient from "../axiosClient";
import "./FeedbackPage.css";

export default function FeedbackPage() {
    const [message, setMessage] = useState("");
    const [rating, setRating] = useState(0);
    const [recentFeedback, setRecentFeedback] = useState([]);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState("");
    const [error, setError] = useState("");

    const loadRecentFeedback = async () => {
        try {
            const res = await axiosClient.get("/feedback/recent?limit=6");
            setRecentFeedback(res.data.data || []);
        } catch (err) {
            setRecentFeedback([]);
        }
    };

    useEffect(() => {
        loadRecentFeedback();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSuccess("");
        setError("");

        if (message.trim().length < 3) {
            setError("Please write at least 3 characters.");
            return;
        }

        try {
            setLoading(true);

            await axiosClient.post("/feedback", {
                message: message.trim(),
                rating: rating || null,
            });

            setMessage("");
            setRating(0);
            setSuccess("Thanks! Your feedback was submitted successfully.");
            await loadRecentFeedback();
        } catch (err) {
            setError(
                err?.response?.data?.message ||
                    "Failed to submit feedback. Please login and try again."
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="feedback-page">
            <section className="feedback-header">
                <h1>Feedback</h1>
                <p>Help improve StudyFlow with your thoughts.</p>
            </section>

            {error && <div className="feedback-alert error">{error}</div>}
            {success && <div className="feedback-alert success">{success}</div>}

            <section className="feedback-layout">
                <form className="feedback-card" onSubmit={handleSubmit}>
                    <h2>Send Feedback</h2>

                    <label htmlFor="feedback-message">Message</label>
                    <textarea
                        id="feedback-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Write your feedback..."
                    />

                    <div className="feedback-stars" aria-label="Rating">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                key={star}
                                type="button"
                                className={rating >= star ? "active" : ""}
                                onClick={() => setRating(star)}
                            >
                                ★
                            </button>
                        ))}
                    </div>

                    <button
                        className="feedback-submit"
                        type="submit"
                        disabled={loading}
                    >
                        {loading ? "Submitting..." : "Submit"}
                    </button>
                </form>

                <section className="feedback-card">
                    <div className="feedback-list-title">
                        <span>Recent Feedback</span>
                        <h2>Students’ thoughts</h2>
                    </div>

                    {recentFeedback.length === 0 ? (
                        <div className="feedback-empty">
                            No feedback yet.
                        </div>
                    ) : (
                        <div className="feedback-list">
                            {recentFeedback.map((item) => (
                                <article className="feedback-item" key={item.id}>
                                    <div className="feedback-item-top">
                                        <strong>{item.name || "Student"}</strong>

                                        {item.rating ? (
                                            <span>{"★".repeat(item.rating)}</span>
                                        ) : null}
                                    </div>

                                    <p>{item.message}</p>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </section>
        </main>
    );
}