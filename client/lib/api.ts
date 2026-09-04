import axios from 'axios';
import { API_BASE } from './config';

// `withCredentials` makes the browser send and receive the httpOnly auth
// cookie. The token is never touched by JS — there's no Authorization header
// to attach anymore.
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

export default api;
