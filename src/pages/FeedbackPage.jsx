import { useEffect, useState } from "react";

const defaultFeedback = [
  {
    name: "Sara",
    role: "Computer Science Student",
    rating: 5,
    text: "StudyFlow helped me summarize long PDFs faster and focus on the important ideas before exams.",
  },
  {
    name: "Ali",
    role: "University Student",
    rating: 4,
    text: "The quiz generator made revision easier because I could practice questions from my own notes.",
  },
  {
    name: "Maya",
    role: "AI Student",
    rating: 5,
    text: "I liked that I can upload material and get summaries, quizzes, and explanations in one place.",
  },
];

function StarRating({ rating }) {
  return (
    <div className="stars-display">
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className={star <= rating ? "star filled" : "star"}>
          &#9733;
        </span>
      ))}
    </div>
  );
}

export default function FeedbackPage() {
  const [feedbacks, setFeedbacks] = useState(() => {
    try {
      const saved = localStorage.getItem("studyflow_feedbacks");
      return saved ? JSON.parse(saved) : defaultFeedback;
    } catch {
      return defaultFeedback;
    }
  });

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [text, setText] = useState("");
  const [rating, setRating] = useState(5);

  useEffect(() => {
    localStorage.setItem("studyflow_feedbacks", JSON.stringify(feedbacks));
  }, [feedbacks]);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!name.trim() || !text.trim()) {
      return;
    }

    const newFeedback = {
      name: name.trim(),
      role: role.trim() || "StudyFlow User",
      rating,
      text: text.trim(),
    };

    setFeedbacks((oldFeedbacks) => [newFeedback, ...oldFeedbacks]);

    setName("");
    setRole("");
    setText("");
    setRating(5);
  };

  return (
    <div style={{ padding: "30px", color: "#111827" }}>
      <h1 style={{ marginBottom: "10px" }}>Feedback</h1>
      <p style={{ color: "#6b7280", marginBottom: "25px" }}>
        Write your feedback. It will also appear on the main page feedback slider.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{
          background: "white",
          padding: "24px",
          borderRadius: "18px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
          marginBottom: "30px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "15px",
            marginBottom: "15px",
          }}
        >
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={{
              padding: "13px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
            }}
          />

          <input
            type="text"
            placeholder="Your role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            style={{
              padding: "13px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
            }}
          />
        </div>

        <div className="rating-box light-rating">
          <p>Your rating</p>
          <div className="rating-buttons">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                type="button"
                key={star}
                className={star <= rating ? "rating-star active" : "rating-star"}
                onClick={() => setRating(star)}
              >
                &#9733;
              </button>
            ))}
          </div>
        </div>

        <textarea
          placeholder="Write your feedback..."
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{
            width: "100%",
            minHeight: "120px",
            padding: "13px",
            borderRadius: "10px",
            border: "1px solid #d1d5db",
            resize: "vertical",
          }}
        ></textarea>

        <button
          type="submit"
          style={{
            marginTop: "15px",
            padding: "12px 22px",
            borderRadius: "999px",
            border: "none",
            background: "#d946ef",
            color: "white",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Add Feedback
        </button>
      </form>

      <h2 style={{ marginBottom: "15px" }}>All Feedback</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "18px",
        }}
      >
        {feedbacks.map((feedback, index) => (
          <div
            key={index}
            style={{
              background: "white",
              padding: "20px",
              borderRadius: "16px",
              boxShadow: "0 8px 25px rgba(0,0,0,0.07)",
            }}
          >
            <StarRating rating={feedback.rating || 5} />

            <p style={{ color: "#374151", lineHeight: "1.6" }}>
              "{feedback.text}"
            </p>

            <h3 style={{ marginBottom: "4px" }}>{feedback.name}</h3>
            <span style={{ color: "#6b7280" }}>{feedback.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
