import React, { createContext, useContext, useEffect, useState } from "react";
import { authAPI } from "../api/endpoints";

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
        const savedToken = localStorage.getItem("authToken");
        const savedUser = localStorage.getItem("user");

        if (savedToken && savedUser) {
            setToken(savedToken);
            setUser(JSON.parse(savedUser));
        }

        setLoading(false);
    }, []);

    const saveAuth = (userData, authToken) => {
        localStorage.setItem("authToken", authToken);
        localStorage.setItem("user", JSON.stringify(userData));

        setUser(userData);
        setToken(authToken);
    };

    const login = async ({ email, password }) => {
        const response = await authAPI.login({ email, password });
        const payload = response.data;

        console.log("LOGIN PAYLOAD:", payload);

        const authToken =
            payload?.data?.token ||
            payload?.token ||
            payload?.access_token ||
            payload?.data?.access_token;

        const authUser =
            payload?.data?.user ||
            payload?.user ||
            payload?.data;

        if (!authToken) {
            throw new Error("Login succeeded but token was not found in response.");
        }

        if (!authUser) {
            throw new Error("Login succeeded but user was not found in response.");
        }

        saveAuth(authUser, authToken);

        return {
            user: authUser,
            token: authToken,
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

    return (
        <AuthContext.Provider
            value={{
                user,
                token,
                loading,
                login,
                logout,
                updateUser,
                isAuthenticated: Boolean(token),
                isAdmin: user?.is_admin || user?.role === "admin" || false,
                isVerified: user?.is_verified || false,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};