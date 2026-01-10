/**
 * Unit tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  parsePrice,
  parsePercentage,
  parseIntSafe,
  extractCardNumber,
  normalizeCardId,
  detectVariantType,
  normalizeCondition,
  cleanHtmlText,
  RateLimiter,
} from '../../src/utils/index.js';

describe('parsePrice', () => {
  it('should parse European format prices', () => {
    expect(parsePrice('€ 5,50')).toBe(5.5);
    expect(parsePrice('€1.234,56')).toBe(1234.56);
    expect(parsePrice('€ 0,99')).toBe(0.99);
  });

  it('should parse US format prices', () => {
    expect(parsePrice('$5.50')).toBe(5.5);
    expect(parsePrice('$1,234.56')).toBe(1234.56);
  });

  it('should handle prices without currency symbol', () => {
    expect(parsePrice('5.50')).toBe(5.5);
    expect(parsePrice('5,50')).toBe(5.5);
  });

  it('should return null for invalid prices', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('invalid')).toBeNull();
  });
});

describe('parsePercentage', () => {
  it('should parse percentage strings', () => {
    expect(parsePercentage('99.5%')).toBe(99.5);
    expect(parsePercentage('+5.2%')).toBe(5.2);
    expect(parsePercentage('-3.1%')).toBe(-3.1);
  });

  it('should handle European decimal format', () => {
    expect(parsePercentage('99,5%')).toBe(99.5);
  });

  it('should return null for invalid input', () => {
    expect(parsePercentage('')).toBeNull();
    expect(parsePercentage('no percent here')).toBeNull();
  });
});

describe('parseIntSafe', () => {
  it('should parse integers from strings', () => {
    expect(parseIntSafe('42')).toBe(42);
    expect(parseIntSafe('42 items')).toBe(42);
    expect(parseIntSafe('-5')).toBe(-5);
  });

  it('should return null for invalid input', () => {
    expect(parseIntSafe('')).toBeNull();
    expect(parseIntSafe('no numbers')).toBeNull();
  });
});

describe('extractCardNumber', () => {
  it('should extract card numbers from standard format', () => {
    const result = extractCardNumber('OP01-003');
    expect(result).toEqual({ setCode: 'OP01', cardNumber: '003' });
  });

  it('should extract from URL paths', () => {
    const result = extractCardNumber('/Products/Singles/Romance-Dawn/Card-Name-ST01-015');
    expect(result).toEqual({ setCode: 'ST01', cardNumber: '015' });
  });

  it('should handle EB sets', () => {
    const result = extractCardNumber('EB01-042');
    expect(result).toEqual({ setCode: 'EB01', cardNumber: '042' });
  });

  it('should return null for invalid format', () => {
    expect(extractCardNumber('no card number')).toBeNull();
  });
});

describe('normalizeCardId', () => {
  it('should create standard card ID', () => {
    expect(normalizeCardId('op01', '3')).toBe('OP01-003');
    expect(normalizeCardId('ST01', '15')).toBe('ST01-015');
  });

  it('should include variant type', () => {
    expect(normalizeCardId('OP01', '003', 'parallel')).toBe('OP01-003-parallel');
    expect(normalizeCardId('OP01', '003', 'regular')).toBe('OP01-003');
  });
});

describe('detectVariantType', () => {
  it('should detect parallel variants', () => {
    expect(detectVariantType('Card Name (Parallel)')).toBe('parallel');
    expect(detectVariantType('Card - Alt Art')).toBe('parallel');
    expect(detectVariantType('Card AA')).toBe('parallel');
  });

  it('should detect manga variants', () => {
    expect(detectVariantType('Card (Manga)')).toBe('manga');
  });

  it('should detect SP variants', () => {
    expect(detectVariantType('Card (SP)')).toBe('sp');
    expect(detectVariantType('Card - Special Art')).toBe('sp');
  });

  it('should default to regular', () => {
    expect(detectVariantType('Regular Card Name')).toBe('regular');
  });
});

describe('normalizeCondition', () => {
  it('should map Cardmarket conditions to standard', () => {
    expect(normalizeCondition('MT')).toBe('NM');
    expect(normalizeCondition('NM')).toBe('NM');
    expect(normalizeCondition('EX')).toBe('LP');
    expect(normalizeCondition('GD')).toBe('MP');
    expect(normalizeCondition('PO')).toBe('DMG');
  });

  it('should default to NM for unknown conditions', () => {
    expect(normalizeCondition('UNKNOWN')).toBe('NM');
  });
});

describe('cleanHtmlText', () => {
  it('should remove extra whitespace', () => {
    expect(cleanHtmlText('  Card   Name  ')).toBe('Card Name');
    expect(cleanHtmlText('Card\n\nName')).toBe('Card Name');
  });
});

describe('RateLimiter', () => {
  it('should allow requests within limit', async () => {
    const limiter = new RateLimiter(10, 10);

    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    // Should be nearly instant
    expect(elapsed).toBeLessThan(100);
  });

  it('should report available tokens', () => {
    const limiter = new RateLimiter(10, 10);
    expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(10);
  });
});
