export const API = import.meta.env.VITE_API || "http://localhost:5000";

// Sends the login token with every request. If the token is expired, log out.
export async function call(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
  });
  if (res.status === 401) {
    localStorage.clear();
    window.location.reload();
  }
  return res;
}
export const json = (path, opts) => call(path, opts).then((r) => r.json());