import { createContext, useContext, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const AuthContext = createContext(null);

const PENDING_VERIFY_EMAIL_KEY = "pendingVerifyEmail";

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem("token"));
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pendingVerifyEmail, setPendingVerifyEmail] = useState(() =>
        localStorage.getItem(PENDING_VERIFY_EMAIL_KEY)
    );

    const setAuthToken = (newToken) => {
        if (newToken) {
            localStorage.setItem("token", newToken);
            setToken(newToken);
        } else {
            localStorage.removeItem("token");
            setToken(null);
        }
    };

    const setPendingEmailForVerification = (email) => {
        const next = (email || "").trim();

        if (next) {
            localStorage.setItem(PENDING_VERIFY_EMAIL_KEY, next);
            setPendingVerifyEmail(next);
        } else {
            localStorage.removeItem(PENDING_VERIFY_EMAIL_KEY);
            setPendingVerifyEmail(null);
        }
    };

    const fetchMe = async () => {
        if (!localStorage.getItem("token")) {
            setUser(null);
            return;
        }

        const res = await axiosClient.get("/auth/me");

        setUser(res.data?.user ?? null);
    };

    const login = async ({ email, password }) => {
        try {
            const res = await axiosClient.post("/auth/login", {
                email,
                password,
            });

            const newToken = res.data?.data?.token;

            setPendingEmailForVerification(null);

            setAuthToken(newToken);

            setUser(res.data?.data?.user ?? null);

            return res;
        } catch (error) {
            if (error?.response?.status === 403) {
                setPendingEmailForVerification(email);
            }
            throw error;
        }
    };

    const register = async ({
        name,
        email,
        password,
        password_confirmation,
    }) => {
        const res = await axiosClient.post("/auth/register", {
            name,
            email,
            password,
            password_confirmation,
        });

        setPendingEmailForVerification(email);

        return res;
    };

    const verifyCode = async ({ email, code }) => {
        const res = await axiosClient.post("/auth/verify-code", {
            email,
            code,
        });

        setPendingEmailForVerification(null);

        return res;
    };

    const sendVerificationCode = async (email) => {
        const res = await axiosClient.post("/auth/send-verification-code", {
            email,
        });

        setPendingEmailForVerification(email);

        return res;
    };

    const logout = async () => {
        const recommendationEmail = JSON.parse(
            localStorage.getItem("logoutRecommendationEmail") || "{}"
        );

        try {
            await axiosClient.post("/auth/logout", {
                pdf_title: recommendationEmail.pdf_title || "Your uploaded PDF",
                focus_source:
                    recommendationEmail.focus_source ||
                    "Focus on the slides recommended by StudyFlow.",
                pdf_path: recommendationEmail.pdf_path || null,
            });
        } catch (error) {
            console.error("Logout API/email error:", error);
        } finally {
            setAuthToken(null);
            setUser(null);
            localStorage.removeItem("logoutRecommendationEmail");
        }
    };

    useEffect(() => {
        let mounted = true;

        const init = async () => {
            try {
                if (localStorage.getItem("token")) {
                    await fetchMe();

                    if (!mounted) return;

                    setToken(localStorage.getItem("token"));
                }
            } catch {
                if (!mounted) return;

                setAuthToken(null);
                setUser(null);
            } finally {
                if (!mounted) return;

                setLoading(false);
            }
        };

        init();

        const onForcedLogout = () => {
            setAuthToken(null);
            setUser(null);
        };

        window.addEventListener("auth:logout", onForcedLogout);

        return () => {
            mounted = false;
            window.removeEventListener("auth:logout", onForcedLogout);
        };
    }, []);

    const value = useMemo(
        () => ({
            token,
            user,
            pendingVerifyEmail,
            loading,
            login,
            register,
            verifyCode,
            sendVerificationCode,
            setPendingVerifyEmail: setPendingEmailForVerification,
            logout,
            fetchMe,
        }),
        [token, user, pendingVerifyEmail, loading]
    );

    return (
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);

    if (!ctx) {
        throw new Error("useAuth must be used within AuthProvider");
    }

    return ctx;
}