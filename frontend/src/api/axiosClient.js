import axios from "axios";

const API_BASE_URL =
    import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api";

console.log("AXIOS CLIENT CONFIG:", {
    baseURL: API_BASE_URL,
});

const axiosClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: 600000, // 10 minutesq
    withCredentials: false,
    headers: {
        Accept: "application/json",
    },
});

axiosClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem("authToken");

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        } else if (config.headers?.Authorization) {
            delete config.headers.Authorization;
        }

        if (config.data instanceof FormData) {
            delete config.headers["Content-Type"];
        } else {
            config.headers["Content-Type"] = "application/json";
        }

        console.log("AXIOS REQUEST:", {
            baseURL: config.baseURL || API_BASE_URL,
            url: config.url,
            method: config.method,
            hasToken: Boolean(token),
            tokenStart: token ? token.slice(0, 10) : null,
        });

        return config;
    },
    (error) => Promise.reject(error)
);

axiosClient.interceptors.response.use(
    (response) => {
        console.log("AXIOS RESPONSE:", {
            baseURL: response.config?.baseURL || API_BASE_URL,
            url: response.config?.url,
            method: response.config?.method,
            status: response.status,
        });

        return response;
    },
    (error) => {
        console.log("AXIOS ERROR:", {
            baseURL: error.config?.baseURL || API_BASE_URL,
            status: error.response?.status,
            url: error.config?.url,
            method: error.config?.method,
            data: error.response?.data,
            authHeader: error.config?.headers?.Authorization,
        });

        return Promise.reject(error);
    }
);

export default axiosClient;
