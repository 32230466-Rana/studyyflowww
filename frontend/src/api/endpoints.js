import apiClient from "./client";

export const authAPI = {
    login: (credentials) => apiClient.post("/auth/login", credentials),
    register: (data) => apiClient.post("/auth/register", data),
    logout: () => apiClient.post("/auth/logout"),
    me: () => apiClient.get("/auth/me"),
};

export const adminAPI = {
    // Get admin stats
    getStats: () => apiClient.get("/admin/stats"),

    // Get all users
    getUsers: (params) => apiClient.get("/admin/users", { params }),

    // Get single user
    getUser: (userId) => apiClient.get(`/admin/users/${userId}`),

    // Create user
    createUser: (data) => apiClient.post("/admin/users", data),

    // Update user
    updateUser: (userId, data) =>
        apiClient.put(`/admin/users/${userId}`, data),

    // Delete user
    deleteUser: (userId) => apiClient.delete(`/admin/users/${userId}`),

    // Change user role
    changeUserRole: (userId, isAdmin) =>
        apiClient.post(`/admin/users/${userId}/change-role`, {
            is_admin: isAdmin,
        }),

    // Change user status
    changeUserStatus: (userId, status) =>
        apiClient.post(`/admin/users/${userId}/change-status`, { status }),

    // Manually verify user email
    verifyUserEmail: (userId) =>
        apiClient.post(`/admin/users/${userId}/verify-email`),

    // Resend verification code to user
    resendVerificationToUser: (userId) =>
        apiClient.post(`/admin/users/${userId}/resend-verification`),
};