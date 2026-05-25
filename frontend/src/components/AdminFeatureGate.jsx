import { featureDisabledMessage } from "../config/adminFeatures";

export default function AdminFeatureGate({ enabled, children }) {
  if (!enabled) {
    return (
      <div className="page-enter">
        <div className="card" style={{ color: "var(--color-muted)" }}>
          {featureDisabledMessage}
        </div>
      </div>
    );
  }

  return children;
}
