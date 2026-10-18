import { describe, it, expect } from 'vitest';
import { parseBountyCsv, csvRowToBounty } from '../../src/services/csvImport';

describe('services/csvImport unit tests', () => {
  describe('parseBountyCsv', () => {
    it('returns empty array when given empty input or whitespace', () => {
      expect(parseBountyCsv('')).toEqual([]);
      expect(parseBountyCsv('   \n  \n')).toEqual([]);
    });

    it('returns empty array when CSV only contains a single header line', () => {
      expect(parseBountyCsv('repo,issueNumber,title')).toEqual([]);
    });

    it('strips UTF-8 BOM if present at the beginning of the file', () => {
      const csv = '\uFEFFrepo,title\norg/repo,Test Bounty';
      const rows = parseBountyCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].repo).toBe('org/repo');
      expect(rows[0].title).toBe('Test Bounty');
    });

    it('parses standard comma-separated rows correctly', () => {
      const csv = 'repo,issueNumber,amount\norg/repo,42,100\norg/other,99,250';
      const rows = parseBountyCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ repo: 'org/repo', issueNumber: '42', amount: '100' });
      expect(rows[1]).toEqual({ repo: 'org/other', issueNumber: '99', amount: '250' });
    });

    it('handles quoted fields and escaped internal quotes', () => {
      const csv = 'repo,title,summary\norg/repo,"Feature with, comma","Summary with ""quotes"" inside"';
      const rows = parseBountyCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Feature with, comma');
      expect(rows[0].summary).toBe('Summary with "quotes" inside');
    });

    it('throws error when headers are duplicated', () => {
      const csv = 'repo,title,repo\norg/repo,Title,other';
      expect(() => parseBountyCsv(csv)).toThrow('CSV headers must be unique.');
    });

    it('throws error when a quoted field is unterminated', () => {
      const csv = 'repo,title\norg/repo,"Unclosed quote string';
      expect(() => parseBountyCsv(csv)).toThrow('CSV contains an unterminated quoted field.');
    });

    it('marks __csvError when row column count does not match header count', () => {
      const csv = 'repo,issueNumber,amount\norg/repo,100';
      const rows = parseBountyCsv(csv);
      expect(rows).toHaveLength(1);
      expect(rows[0].__csvError).toBe(
        'CSV row has a different number of columns than the header.',
      );
    });
  });

  describe('csvRowToBounty', () => {
    it('converts row into bounty payload structure', () => {
      const row = {
        repo: 'ritik4ever/stellar-bounty-board',
        issueNumber: '100',
        title: 'Fix issue',
        summary: 'Details',
        maintainer: 'bob',
        tokenSymbol: 'XLM',
        amount: '50',
        deadlineDays: '14',
        labels: 'bug | backend | p1',
      };

      const bounty = csvRowToBounty(row);
      expect(bounty).toEqual({
        repo: 'ritik4ever/stellar-bounty-board',
        issueNumber: '100',
        title: 'Fix issue',
        summary: 'Details',
        maintainer: 'bob',
        tokenSymbol: 'XLM',
        amount: '50',
        deadlineDays: '14',
        labels: ['bug', 'backend', 'p1'],
      });
    });

    it('handles empty or missing labels gracefully', () => {
      const row = {
        repo: 'ritik4ever/stellar-bounty-board',
        title: 'No labels',
      };
      const bounty = csvRowToBounty(row);
      expect(bounty.labels).toEqual([]);
    });

    it('includes templateId if present in row', () => {
      const row = {
        repo: 'ritik4ever/stellar-bounty-board',
        templateId: 'feature',
      };
      const bounty = csvRowToBounty(row);
      expect(bounty.templateId).toBe('feature');
    });
  });
});
