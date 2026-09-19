/**
 * A06 offline tests for `draft-request`, driven by the fake provider. No
 * network. Moved verbatim out of `extract-reply.live.test.ts` at CP1
 * (docs/contracts/requests/A06.md) so they run in the default suite.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRequestInput } from '@retrofit/contracts';
import { createFakeLlm } from '../fake-provider';
import { LlmUnavailableError } from '../types';
import type { LlmProvider } from '../types';
import { draftProblems, draftRequestCall, templateDraft } from './draft-request';
/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */
const draftInput = (over: Partial<DraftRequestInput> = {}): DraftRequestInput => ({
  insuredName: 'Harbor Freight Storage LLC',
  brokerName: 'Keystone Brokerage',
  contactName: 'Dana Ruiz',
  fields: [
    { canonicalPath: 'buildings.yearBuilt', label: 'year built', why: 'it decides the building-age factor' },
  ],
  tone: 'short_and_specific',
  ...over,
});

const twoFields: DraftRequestInput['fields'] = [
  { canonicalPath: 'buildings.yearBuilt', label: 'Year built for Building C', why: 'it decides the building-age factor' },
  { canonicalPath: 'buildings.sprinklered', label: 'Sprinkler status', why: 'it decides the protection factor' },
];
/* -------------------------------------------------------------------------- */
/* Offline — draft-request                                                    */
/* -------------------------------------------------------------------------- */

describe('offline: draft-request', () => {
  it('returns the model draft when every requested field is named and nothing else is asked', async () => {
    const fake = createFakeLlm();
    const out = await draftRequestCall(fake, draftInput());
    expect(out.subject).toBe('Information needed to complete our review');
    expect(out.body).toContain('year built for Building C');
    const [call] = fake.callsFor('draft-request');
    expect(call?.prompt).toContain('- year built — it decides the building-age factor');
    expect(call?.prompt).toContain('Greet: Dana Ruiz');
    expect(call?.partKinds).toEqual([]);
  });

  it('falls back to the template when the model omits a requested field', async () => {
    const fake = createFakeLlm({
      overrides: { 'draft-request': { subject: 'Quick question', body: 'Hello Dana,\n\n- Year built for Building C: needed.\n\nThank you.' } },
    });
    const input = draftInput({ fields: twoFields });
    const out = await draftRequestCall(fake, input);
    expect(out).toEqual(templateDraft(input));
    expect(out.body).toContain('- Sprinkler status: it decides the protection factor');
  });

  it('falls back when the model asks for something that was not requested', async () => {
    const body =
      'Hello Dana,\n\n- Year built for Building C: decides building age.\n- Sprinkler status: decides protection.\n' +
      '- Five years of loss runs\n\nThank you.';
    const fake = createFakeLlm({ overrides: { 'draft-request': { subject: 'Info needed', body } } });
    const out = await draftRequestCall(fake, draftInput({ fields: twoFields }));
    expect(out.subject).toBe('Information needed: Harbor Freight Storage LLC');
    expect(out.body).not.toContain('loss runs');
  });

  it('falls back on an extra question, a dollar figure or a placeholder', () => {
    const fields = twoFields;
    const ok = 'Hello,\n\n- Year built for Building C: age factor.\n- Sprinkler status: protection.\n\nThank you.';
    expect(draftProblems({ subject: 'Info', body: ok }, fields)).toBeNull();
    expect(draftProblems({ subject: 'Info', body: `${ok}\nCould you also send the roof age?` }, fields)).toMatch(/extra question/);
    expect(draftProblems({ subject: 'Info', body: `${ok}\nWhat is the year built for Building C?` }, fields)).toBeNull();
    expect(draftProblems({ subject: 'Info', body: `${ok}\nThe premium is $88,000.` }, fields)).toMatch(/dollar/);
    expect(draftProblems({ subject: 'Info', body: `${ok}\n[Your Name]` }, fields)).toMatch(/placeholder/);
    expect(draftProblems({ subject: ' ', body: ok }, fields)).toBe('empty subject');
  });

  it('the template always passes its own check, with and without names', () => {
    for (const input of [
      draftInput({ fields: twoFields }),
      draftInput({ insuredName: null, brokerName: null, contactName: null, fields: twoFields }),
    ]) {
      const draft = templateDraft(input);
      expect(draftProblems(draft, input.fields)).toBeNull();
    }
    const anonymous = templateDraft(draftInput({ insuredName: null, brokerName: null, contactName: null }));
    expect(anonymous.body.startsWith('Hello,\n')).toBe(true);
    expect(anonymous.subject).toBe('Information needed to complete our review');
    expect(templateDraft(draftInput({ contactName: null })).body.startsWith('Hello Keystone Brokerage,')).toBe(true);
  });

  it('falls back to the template when the call fails, and rethrows an unconfigured provider', async () => {
    const input = draftInput({ fields: twoFields });
    const failing = createFakeLlm({ failFor: ['draft-request'] });
    expect(await draftRequestCall(failing, input)).toEqual(templateDraft(input));
    expect(failing.callsFor('draft-request')).toHaveLength(2); // one retry

    const unconfigured: LlmProvider = {
      name: 'none',
      configured: false,
      generateJson: () => Promise.reject(new LlmUnavailableError('draft-request')),
    };
    await expect(draftRequestCall(unconfigured, input)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('dedupes fields and refuses an empty request', async () => {
    const input = draftInput({ fields: [twoFields[0]!, twoFields[0]!] });
    expect(templateDraft(input).body.match(/^- /gm)).toHaveLength(1);
    await expect(draftRequestCall(createFakeLlm(), draftInput({ fields: [] }))).rejects.toThrow(/at least one/);
  });
});
