import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  listBountyTemplates,
  getBountyTemplate,
  applyBountyTemplate,
} from '../../src/services/bountyTemplates';

describe('services/bountyTemplates unit tests', () => {
  let tmpDir: string;
  let tmpStorePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounty-templates-test-'));
    tmpStorePath = path.join(tmpDir, 'templates.json');
    process.env.BOUNTY_TEMPLATE_STORE_PATH = tmpStorePath;
  });

  afterEach(() => {
    delete process.env.BOUNTY_TEMPLATE_STORE_PATH;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('listBountyTemplates', () => {
    it('creates default templates if store file does not exist', () => {
      const templates = listBountyTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThanOrEqual(3);
      expect(templates.map((t) => t.id)).toContain('small-bug-fix');
      expect(templates.map((t) => t.id)).toContain('feature');
      expect(templates.map((t) => t.id)).toContain('documentation');
      expect(fs.existsSync(tmpStorePath)).toBe(true);
    });

    it('reads existing templates correctly from custom store file', () => {
      const customTemplates = [
        {
          id: 'custom-template',
          name: 'Custom Template',
          amount: 500,
          labels: ['security'],
          deadlineDays: 30,
          tokenSymbol: 'USDC',
        },
      ];
      fs.writeFileSync(tmpStorePath, JSON.stringify(customTemplates, null, 2), 'utf8');

      const loaded = listBountyTemplates();
      expect(loaded).toEqual(customTemplates);
    });
  });

  describe('getBountyTemplate', () => {
    it('returns template when given an existing ID', () => {
      const template = getBountyTemplate('feature');
      expect(template.id).toBe('feature');
      expect(template.amount).toBe(100);
      expect(template.labels).toEqual(['enhancement']);
    });

    it('throws when template ID is not found', () => {
      expect(() => getBountyTemplate('non-existent-id')).toThrow('Bounty template not found.');
    });

    it('throws when template ID is empty or whitespace', () => {
      expect(() => getBountyTemplate('')).toThrow('Bounty template not found.');
      expect(() => getBountyTemplate('   ')).toThrow('Bounty template not found.');
    });
  });

  describe('applyBountyTemplate', () => {
    it('merges template defaults with input overrides', () => {
      const result = applyBountyTemplate({
        templateId: 'small-bug-fix',
        title: 'Fix issue',
        maintainer: 'alice',
      });

      expect(result).toMatchObject({
        title: 'Fix issue',
        maintainer: 'alice',
        amount: 25,
        labels: ['bug'],
        deadlineDays: 7,
        tokenSymbol: 'XLM',
      });
      expect(result.templateId).toBeUndefined();
    });

    it('allows caller to override template defaults', () => {
      const result = applyBountyTemplate({
        templateId: 'small-bug-fix',
        amount: 50,
        tokenSymbol: 'USDC',
      });

      expect(result.amount).toBe(50);
      expect(result.tokenSymbol).toBe('USDC');
      expect(result.deadlineDays).toBe(7);
      expect(result.labels).toEqual(['bug']);
    });

    it('returns input unchanged if templateId is absent or not a string', () => {
      const noTemplate = { title: 'No template' };
      expect(applyBountyTemplate(noTemplate)).toEqual(noTemplate);

      const invalidType = { templateId: 12345, title: 'Numeric template ID' };
      expect(applyBountyTemplate(invalidType)).toEqual(invalidType);
    });

    it('returns input unchanged if templateId is blank or whitespace', () => {
      const blank = { templateId: '   ', title: 'Blank template ID' };
      expect(applyBountyTemplate(blank)).toEqual(blank);
    });

    it('propagates error when templateId does not exist', () => {
      expect(() =>
        applyBountyTemplate({
          templateId: 'unknown-template',
        }),
      ).toThrow('Bounty template not found.');
    });
  });
});
