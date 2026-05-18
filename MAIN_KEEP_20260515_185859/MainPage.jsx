import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../Main.css";

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
  {
    name: "Karim",
    role: "Software Engineering Student",
    rating: 4,
    text: "The MCQ questions helped me discover which parts of the lecture I did not understand well.",
  },
  {
    name: "Nour",
    role: "Information Technology Student",
    rating: 5,
    text: "StudyFlow saves time when lectures are long and I need a quick review before studying deeply.",
  },
  {
    name: "Jana",
    role: "Web Programming Student",
    rating: 5,
    text: "The interface is simple, and the study tools make the learning process more organized.",
  },
  {
    name: "Hadi",
    role: "Data Science Student",
    rating: 4,
    text: "I used the summaries to review chapters quickly, then tested myself using generated questions.",
  },
  {
    name: "Lina",
    role: "CS Student",
    rating: 5,
    text: "It feels useful because the questions are connected to my notes instead of random topics.",
  },
  {
    name: "Omar",
    role: "University Student",
    rating: 4,
    text: "The app helped me prepare better by turning my material into something I can practice with.",
  },
  {
    name: "Rima",
    role: "Student",
    rating: 5,
    text: "I like the idea of having notes, AI summaries, and quizzes together in one learning platform.",
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

export default function MainPage() {
  const [feedbacks, setFeedbacks] = useState(() => {
    try {
      const saved = localStorage.getItem("studyflow_feedbacks");
      return saved ? JSON.parse(saved) : defaultFeedback;
    } catch {
      return defaultFeedback;
    }
  });

  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackRole, setFeedbackRole] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(5);

  useEffect(() => {
    localStorage.setItem("studyflow_feedbacks", JSON.stringify(feedbacks));
  }, [feedbacks]);

  const handleFeedbackSubmit = (event) => {
    event.preventDefault();

    if (!feedbackName.trim() || !feedbackText.trim()) {
      return;
    }

    const newFeedback = {
      name: feedbackName.trim(),
      role: feedbackRole.trim() || "StudyFlow User",
      rating: feedbackRating,
      text: feedbackText.trim(),
    };

    setFeedbacks((oldFeedbacks) => [newFeedback, ...oldFeedbacks]);

    setFeedbackName("");
    setFeedbackRole("");
    setFeedbackText("");
    setFeedbackRating(5);
  };

  const sliderFeedbacks = [...feedbacks, ...feedbacks];

  return (
    <div className="main-page">
      <nav className="navbar">
        <h2>StudyFlow</h2>

        <div className="nav-links">
          <span className="status">Connected</span>
          <Link to="/login">Login</Link>
          <Link className="register-btn" to="/register">Register</Link>
        </div>
      </nav>

      <section className="hero">
        <h1>Study Smarter with AI</h1>
        <p>
          Upload notes, generate summaries, and test yourself with intelligent AI quizzes.
        </p>

        <div className="hero-buttons">
          <Link className="primary-btn" to="/register">Get Started</Link>
          <Link className="secondary-btn" to="/login">Login</Link>
        </div>
      </section>

      <section className="features">
        <div className="feature-card">
          <div className="icon">PDF</div>
          <h3>Upload Notes</h3>
          <p>Upload PDFs or text and keep your study material organized.</p>
        </div>

        <div className="feature-card">
          <div className="icon">AI</div>
          <h3>AI Summary</h3>
          <p>Generate clear summaries from your own notes in seconds.</p>
        </div>

        <div className="feature-card">
          <div className="icon">Q</div>
          <h3>Quiz Generator</h3>
          <p>Create practice questions from your uploaded study material.</p>
        </div>
      </section>

      <section className="stats-section">
        <div className="stat-box">
          <h2>1000+</h2>
          <p>Study actions generated</p>
        </div>

        <div className="stat-box">
          <h2>{feedbacks.length}+</h2>
          <p>Student feedback</p>
        </div>

        <div className="stat-box">
          <h2>5</h2>
          <p>Star rating system</p>
        </div>
      </section>

      <section className="feedback-section">
        <div className="feedback-header">
          <h2>Student Feedback</h2>
          <p>Write your feedback and it will appear first in the slider.</p>
        </div>

        <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
          <h3>Write Your Feedback</h3>

          <div className="form-row">
            <input
              type="text"
              placeholder="Your name"
              value={feedbackName}
              onChange={(event) => setFeedbackName(event.target.value)}
            />

            <input
              type="text"
              placeholder="Your role"
              value={feedbackRole}
              onChange={(event) => setFeedbackRole(event.target.value)}
            />
          </div>

          <div className="rating-box">
            <p>Your rating</p>
            <div className="rating-buttons">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  className={star <= feedbackRating ? "rating-star active" : "rating-star"}
                  onClick={() => setFeedbackRating(star)}
                >
                  &#9733;
                </button>
              ))}
            </div>
          </div>

          <textarea
            placeholder="Write your feedback..."
            value={feedbackText}
            onChange={(event) => setFeedbackText(event.target.value)}
          ></textarea>

          <button type="submit">Add Feedback</button>
        </form>

        <div className="feedback-slider">
          <div className="feedback-track">
            {sliderFeedbacks.map((feedback, index) => (
              <div className="feedback-slide" key={index}>
                <StarRating rating={feedback.rating || 5} />
                <p>"{feedback.text}"</p>

                <div className="feedback-user">
                  <div className="avatar">
                    {feedback.name.charAt(0).toUpperCase()}
                  </div>

                  <div>
                    <h4>{feedback.name}</h4>
                    <span>{feedback.role}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta">
        <h2>Ready to study smarter?</h2>
        <p>Start uploading your notes and let StudyFlow help you prepare better.</p>
        <Link className="primary-btn" to="/register">Start Now</Link>
      </section>

      <footer>2026 StudyFlow - AI Powered Learning</footer>
    </div>
  );
}
