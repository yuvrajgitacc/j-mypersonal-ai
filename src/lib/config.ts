// In production (Render), frontend is served from the same origin as the backend.
// In development, the backend runs on localhost:3001.
export const API_BASE = import.meta.env.VITE_API_URL || '';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
