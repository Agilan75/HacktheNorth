import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useLocation } from 'react-router';
import { ROUTES } from '../routes.js';
/** Catch-all route: an unknown address says so instead of silently showing the queue. */
export function NotFoundPage() {
    const { pathname } = useLocation();
    return (_jsxs("section", { className: "not-found-page", "aria-labelledby": "not-found-title", children: [_jsx("h1", { id: "not-found-title", children: "Page not found" }), _jsxs("p", { children: ["Nothing in the console lives at ", _jsx("code", { children: pathname }), "."] }), _jsx("p", { children: _jsx(Link, { to: ROUTES.queue, className: "rf-button", children: "Back to the queue" }) })] }));
}
//# sourceMappingURL=NotFoundPage.js.map