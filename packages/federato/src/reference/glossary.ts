/** GLOSSARY.pdf transcription. Body owned by Run 1 unit F06. */
import type { GlossaryDocument, GlossaryEntry } from '../types';

export const GLOSSARY_DOC = 'GLOSSARY.pdf';

export function glossaryEntries(): readonly GlossaryEntry[] {
  throw new Error('NOT_IMPLEMENTED:F06');
}

export function readGlossary(): GlossaryDocument {
  throw new Error('NOT_IMPLEMENTED:F06');
}

/** Case-insensitive lookup over terms and aliases; powers the console tooltips. */
export function lookupTerm(_term: string): GlossaryEntry | null {
  throw new Error('NOT_IMPLEMENTED:F06');
}
