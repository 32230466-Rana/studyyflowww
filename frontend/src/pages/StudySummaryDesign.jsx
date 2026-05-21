import "./StudySummaryDesign.css";

export default function StudySummaryDesign({ data = {} }) {
  const summary = data.summary || "";
  const expectation = data.expectation || [];
  const mainIdea = data.mainIdea || "";
  const shortSummary = data.shortSummary || "";
  const revision = data.revision || [];
  const impliedIdea = data.impliedIdea || [];
  const theme = data.theme || "";
  const importantQuotes = data.importantQuotes || [];

  return (
    <section className="study-summary-page">
      <div className="study-summary-paper">
        <div className="summary-top-decor">
          <span>✦</span>
          <span>♡</span>
          <span>✧</span>
        </div>

        <h1 className="summary-main-title">STUDY SUMMARY</h1>
        <p className="summary-subtitle">
          Clean revision sheet for understanding the lesson quickly
        </p>

        <div className="summary-grid">
          <div className="summary-box big purple">
            <div className="box-ribbon">SUMMARY</div>
            <p>
              {summary ||
                "Write the full summary of the lesson here in a clear and simple way."}
            </p>
            <span className="box-doodle">✿</span>
          </div>

          <div className="summary-box pink">
            <div className="box-ribbon">EXPECTATION</div>
            <ul>
              {(expectation.length
                ? expectation
                : [
                    "What do you expect this lesson to explain?",
                    "What question should you focus on?",
                    "What idea might be important for the exam?",
                  ]
              ).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            <span className="heart-line">♡</span>
          </div>

          <div className="summary-box yellow">
            <div className="box-ribbon">MAIN IDEA</div>
            <p>
              {mainIdea ||
                "Write the central idea of the lesson here. Keep it direct and easy to remember."}
            </p>
            <span className="box-doodle">💡</span>
          </div>

          <div className="summary-box wide blue">
            <div className="box-ribbon">SHORT SUMMARY</div>
            <p>
              {shortSummary ||
                "Write a very short version of the lesson here, only the most important points."}
            </p>
          </div>

          <div className="summary-box green">
            <div className="box-ribbon">REVISION — Key Points</div>
            <ol>
              {(revision.length
                ? revision
                : [
                    "First important point",
                    "Second important point",
                    "Third important point",
                    "Fourth important point",
                    "Fifth important point",
                  ]
              ).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
            <span className="box-doodle">☘</span>
          </div>

          <div className="summary-box pink dashed">
            <div className="box-ribbon">IMPLIED IDEA</div>
            <ul>
              {(impliedIdea.length
                ? impliedIdea
                : [
                    "Hidden meaning or deeper lesson",
                    "What the author wants us to understand",
                    "Message behind the topic",
                  ]
              ).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="summary-box purple cloud-box">
            <div className="box-ribbon">THEME</div>
            <p>
              {theme ||
                "Write the main theme here in one or two simple sentences."}
            </p>
            <span className="heart-bottom">♡</span>
          </div>

          <div className="summary-box quote-box wide">
            <div className="box-ribbon">IMPORTANT QUOTES</div>
            <ul>
              {(importantQuotes.length
                ? importantQuotes
                : [
                    "Important quote or sentence from the lesson",
                    "Another key sentence that helps in revision",
                  ]
              ).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}