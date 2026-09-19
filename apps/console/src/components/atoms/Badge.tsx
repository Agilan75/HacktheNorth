import type { ReactElement } from 'react';

export interface BadgeProps {
  readonly label: string;
  readonly tone?: 'neutral' | 'attention' | 'quiet';
  readonly title?: string;
}

/**
 * A small labelled badge, e.g. '1 flip from FIT'. Tone is decoration; the label carries the meaning.
 *
 * Stub frozen by W0-4. Unit C02 replaces this body only.
 */
export function Badge(props: BadgeProps): ReactElement {
  const tone = props.tone ?? 'neutral';
  return (
    <span className={`rf-badge rf-badge--${tone}`} data-tone={tone} title={props.title}>
      {props.label}
    </span>
  );
}
