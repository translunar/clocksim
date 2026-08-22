import { describe, it, expect } from 'vitest';
import { GLOSSARY, REQUIRED_TERMS } from '../../src/ui/glossary';

describe('glossary', () => {
  it('defines every required term with short and long text', () => {
    for (const t of REQUIRED_TERMS) {
      expect(GLOSSARY[t], t).toBeDefined();
      expect(GLOSSARY[t]!.short.length).toBeGreaterThan(10);
      expect(GLOSSARY[t]!.long.length).toBeGreaterThan(60);
    }
  });
});
