import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router';

import { ROUTES } from '../routes.js';

/** Catch-all route: an unknown address says so instead of silently showing the queue. */
export function NotFoundPage(): ReactElement {
  const { pathname } = useLocation();
  return (
    <section className="not-found-page" aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <p>
        Nothing in the console lives at <code>{pathname}</code>.
      </p>
      <p>
        <Link to={ROUTES.queue} className="rf-button">
          Back to the queue
        </Link>
      </p>
    </section>
  );
}
