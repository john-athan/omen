// Text from other players and outside sources, made safe for HTML.

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Escaping alone keeps a javascript: link working, so a link is only kept
// when it is a web address.
export const href = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? esc(u) : "#");
