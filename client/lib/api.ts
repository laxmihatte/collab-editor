import axios from 'axios';

// `withCredentials` makes the browser send and receive the httpOnly auth
// cookie. The token is never touched by JS — there's no Authorization header
// to attach anymore.
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  withCredentials: true,
});

export default api;
