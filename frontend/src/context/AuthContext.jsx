import React, { createContext, useContext, useEffect, useState } from "react";
import { authAPI } from "../api/endpoints";
export { AuthProvider, useAuth } from "../auth/AuthContext.jsx";
const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error("useAuth must be used within AuthProvider");
    }

    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        try {
            const savedToken = localStorage.getItem("authToken");
            const savedUser = localStorage.getItem("user");

            if (savedToken && savedUser) {
                setToken(savedToken);
                setUser(JSON.parse(savedUser));
            }
        } catch (error) {
            console.log("Auth load error:", error);
            localStorage.removeItem("authToken");
            localStorage.removeItem("user");
        } finally {
            setLoading(false);
        }
    }, []);

    const saveAuth = (userData, authToken) => {
        localStorage.setItem("authToken", authToken);
        localStorage.setItem("user", JSON.stringify(userData));

        setUser(userData);
        setToken(authToken);
    };

    const login = async ({ email, password }) => {
        const response = await authAPI.login({ email, password });
        const data = response.data;

        console.log("LOGIN RESPONSE:", data);

        const returnedToken =
            data.token ||
            data.access_token ||
            data.authToken ||
            data.plainTextToken ||
            data.data?.token ||
            data.data?.access_token ||
            data.data?.plainTextToken;

        const returnedUser =
            data.user ||
            data.auth_user ||
            data.data?.user ||
            data.data?.auth_user ||
            data.data;

        if (!returnedToken || !returnedUser) {
            throw new Error("Login response missing user or token.");
        }

        saveAuth(returnedUser, returnedToken);

        return {
            user: returnedUser,
            token: returnedToken,
            raw: data,
        };
    };

    const logout = async () => {
        try {
            await authAPI.logout();
        } catch (error) {
            console.log("Logout error:", error);
        } finally {
            localStorage.removeItem("authToken");
            localStorage.removeItem("user");
            setUser(null);
            setToken(null);
        }
    };

    const updateUser = (userData) => {
        setUser((currentUser) => {
            const nextUser = currentUser ? { ...currentUser, ...userData } : userData;
            localStorage.setItem("user", JSON.stringify(nextUser));
            return nextUser;
        });
    };

    const value = {
        user,
        token,
        loading,
        login,
        logout,
        updateUser,
        isAuthenticated: Boolean(token),
        isAdmin: user?.is_admin || user?.role === "admin" || false,
        isVerified: user?.is_verified || false,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};