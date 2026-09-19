import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReplyBox } from './ReplyBox.js';
import type { ReplyResultView } from './types.js';

afterEach(cleanup);

const noop = (): void => {};

const result: ReplyResultView = {
  fields: [
    {
      path: 'buildings.B-1.yearBuilt',
      label: 'Year built (B-1)',
      value: '1991',
      confidence: 0.92,
      accepted: true,
      quote: 'Building B-1 was built in 1991 per the county assessor.',
      rejectedReason: null,
    },
    {
      path: 'pricing.quotedPremium',
      label: 'Quoted premium',
      value: '175000',
      confidence: 0.55,
      accepted: false,
      quote: 'premium somewhere around 175k I think',
      rejectedReason: null,
    },
    {
      path: 'buildings.B-2.tiv',
      label: 'Building TIV',
      value: '9',
      confidence: 0.85,
      accepted: false,
      quote: 'nine',
      rejectedReason: 'Conflicts with the submitted value',
    },
  ],
  before: {
    actionId: 'a',
    submissionId: 's',
    insuredName: 'Acme',
    type: 'ingest_reply',
    status: 'applied',
    createdAt: '2026-09-19T12:30:00.000Z',
    beforeScore: 84,
    afterScore: null,
    beforeRank: 5,
    afterRank: null,
    beforeVerdict: 'REFER',
    afterVerdict: null,
  },
  after: {
    actionId: 'a',
    submissionId: 's',
    insuredName: 'Acme',
    type: 'ingest_reply',
    status: 'applied',
    createdAt: '2026-09-19T12:30:00.000Z',
    beforeScore: 84,
    afterScore: 92,
    beforeRank: 5,
    afterRank: 2,
    beforeVerdict: 'REFER',
    afterVerdict: 'FIT',
  },
};

describe('ReplyBox', () => {
  it('submits trimmed pasted text and clears the box', async () => {
    const onSubmitText = vi.fn(() => Promise.resolve());
    render(<ReplyBox submissionId="s" result={null} pending={false} onSubmitText={onSubmitText} onSubmitFile={noop} />);
    const box = screen.getByLabelText("Paste the broker's reply");
    const button = screen.getByRole('button', { name: 'Extract fields' });
    expect(button).toBeDisabled();
    fireEvent.change(box, { target: { value: '  built in 1991  ' } });
    expect(button).toBeEnabled();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onSubmitText).toHaveBeenCalledWith('built in 1991');
    expect(box).toHaveValue('');
  });

  it('uploads a file', async () => {
    const onSubmitFile = vi.fn();
    render(<ReplyBox submissionId="s" result={null} pending={false} onSubmitText={noop} onSubmitFile={onSubmitFile} />);
    const file = new File(['loss runs'], 'loss-runs.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Or upload a reply/), { target: { files: [file] } });
    });
    expect(onSubmitFile).toHaveBeenCalledWith(file);
  });

  it('disables input while pending', () => {
    render(<ReplyBox submissionId="s" result={null} pending onSubmitText={noop} onSubmitFile={noop} />);
    expect(screen.getByRole('button', { name: 'Extracting…' })).toBeDisabled();
    expect(screen.getByLabelText("Paste the broker's reply")).toBeDisabled();
    expect(screen.getByText('Reading the reply…')).toBeInTheDocument();
  });

  it('shows a submit failure as an alert', async () => {
    const onSubmitText = vi.fn(() => Promise.reject(new Error('Gemini unavailable')));
    render(<ReplyBox submissionId="s" result={null} pending={false} onSubmitText={onSubmitText} onSubmitFile={noop} />);
    fireEvent.change(screen.getByLabelText("Paste the broker's reply"), { target: { value: 'x' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract fields' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Reply failed: Gemini unavailable');
  });

  it('renders each extracted field with confidence, status and the quote', () => {
    render(<ReplyBox submissionId="s" result={result} pending={false} onSubmitText={noop} onSubmitFile={noop} />);
    const rows = screen.getAllByTestId('reply-field');
    expect(rows).toHaveLength(3);
    expect(rows[0]!).toHaveAttribute('data-accepted', 'true');
    expect(within(rows[0]!).getByText('92%')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Accepted')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('“Building B-1 was built in 1991 per the county assessor.”')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('55%')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Needs confirmation (under 80%)')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Conflicts with the submitted value')).toBeInTheDocument();
  });

  it('shows the before and after numbers the reply caused', () => {
    render(<ReplyBox submissionId="s" result={result} pending={false} onSubmitText={noop} onSubmitFile={noop} />);
    expect(screen.getByTestId('reply-before')).toHaveTextContent('score 84, rank 5, Refer');
    expect(screen.getByTestId('reply-after')).toHaveTextContent('score 92, rank 2, Fit');
  });
});
