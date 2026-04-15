import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth.jsx";

export default function VerifyPage() {
    const { pendingVerifyEmail, sendVerificationCode, verifyCode } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const [email] = useState(location.state?.email || pendingVerifyEmail || "");
    const [otp, setOtp] = useState(["", "", "", "", "", ""]);
    const inputsRef = useRef([]);

    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const [initialSending, setInitialSending] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [timeLeft, setTimeLeft] = useState(0);

    useEffect(() => {
        if (timeLeft <= 0) return;

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [timeLeft]);

    useEffect(() => {
        let mounted = true;

        const sendInitialCode = async () => {
            if (!email) {
                if (mounted) {
                    setError("Email is missing");
                }
                return;
            }

            try {
                if (mounted) {
                    setInitialSending(true);
                    setError("");
                    setSuccess("");
                }

                await sendVerificationCode(email);

                if (mounted) {
                    setSuccess("Verification code sent 📧");
                    setTimeLeft(30);
                }
            } catch (err) {
                if (mounted) {
                    setError(
                        err?.response?.data?.message ||
                            "Failed to send verification code"
                    );
                }
            } finally {
                if (mounted) {
                    setInitialSending(false);
                }
            }
        };

        sendInitialCode();

        return () => {
            mounted = false;
        };
    }, [email, sendVerificationCode]);

    const handleChange = (value, index) => {
        if (!/^\d?$/.test(value)) return;

        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        if (value && index < otp.length - 1) {
            inputsRef.current[index + 1]?.focus();
        }
    };

    const handleBackspace = (e, index) => {
        if (e.key === "Backspace" && !otp[index] && index > 0) {
            inputsRef.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e) => {
        const pasted = e.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, 6);
        if (!pasted) return;

        e.preventDefault();

        const newOtp = [...otp];
        for (let i = 0; i < 6; i += 1) {
            newOtp[i] = pasted[i] || "";
        }
        setOtp(newOtp);

        const nextIndex = Math.min(pasted.length, 5);
        inputsRef.current[nextIndex]?.focus();
    };

    const onVerify = async (e) => {
        e.preventDefault();
        if (submitting) return;

        const code = otp.join("");

        if (!email) {
            setError("Email is missing");
            return;
        }

        if (code.length !== 6) {
            setError("Please enter the 6-digit code");
            return;
        }

        setSubmitting(true);
        setError("");
        setSuccess("");

        try {
            await verifyCode({ email, code });
            setSuccess("Email verified 🎉");
            navigate("/login");
        } catch (err) {
            setError(err?.response?.data?.message || "Invalid code");
        } finally {
            setSubmitting(false);
        }
    };

    const onResend = async () => {
        if (resending || timeLeft > 0) return;

        if (!email) {
            setError("Email is missing");
            return;
        }

        setResending(true);
        setError("");
        setSuccess("");

        try {
            await sendVerificationCode(email);
            setSuccess("New code sent 📧");
            setOtp(["", "", "", "", "", ""]);
            setTimeLeft(30);
            inputsRef.current[0]?.focus();
        } catch (err) {
            setError(err?.response?.data?.message || "Failed to resend");
        } finally {
            setResending(false);
        }
    };

    return (
        <div className="authLayout">
            <div className="card authCard" style={{ textAlign: "center" }}>
                <h2>Verify your email</h2>
                <p className="muted">{email || "No email found"}</p>

                {error && <div className="errorBox">{error}</div>}
                {success && <div className="pill">{success}</div>}
                {initialSending && (
                    <p className="muted">Sending verification code...</p>
                )}

                <form onSubmit={onVerify}>
                    <div
                        style={{
                            display: "flex",
                            gap: "10px",
                            justifyContent: "center",
                            margin: "20px 0",
                            flexWrap: "wrap",
                        }}
                    >
                        {otp.map((digit, index) => (
                            <input
                                key={index}
                                ref={(el) => {
                                    inputsRef.current[index] = el;
                                }}
                                value={digit}
                                onChange={(e) =>
                                    handleChange(e.target.value, index)
                                }
                                onKeyDown={(e) => handleBackspace(e, index)}
                                onPaste={handlePaste}
                                maxLength={1}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                style={{
                                    width: "45px",
                                    height: "55px",
                                    textAlign: "center",
                                    fontSize: "22px",
                                    borderRadius: "10px",
                                    border: "1px solid #ddd",
                                    outline: "none",
                                }}
                            />
                        ))}
                    </div>

                    <button
                        type="submit"
                        className="button buttonAccent"
                        disabled={submitting || initialSending}
                    >
                        {submitting ? "Verifying..." : "Verify"}
                    </button>
                </form>

                <div style={{ marginTop: "15px" }}>
                    <button
                        type="button"
                        className="button buttonSecondary"
                        onClick={onResend}
                        disabled={timeLeft > 0 || resending || initialSending}
                    >
                        {resending
                            ? "Sending..."
                            : timeLeft > 0
                            ? `Wait ${timeLeft}s`
                            : "Resend Code"}
                    </button>

                    {timeLeft > 0 && (
                        <p className="muted">Resend in {timeLeft}s</p>
                    )}
                </div>

                <p className="muted" style={{ marginTop: "15px" }}>
                    Back to <Link to="/login">Login</Link>
                </p>
            </div>
        </div>
    );
}
