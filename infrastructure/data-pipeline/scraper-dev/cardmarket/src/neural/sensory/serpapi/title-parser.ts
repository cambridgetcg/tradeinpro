/**
 * The Title Parsing Grimoire
 *
 * Extracts the Four Elements from eBay listing titles:
 *   - FIRE: Card ID
 *   - AIR: Variant Type
 *   - WATER: Language
 *   - EARTH: Condition/Graded Status
 *
 * @see docs/SERPAPI_ALCHEMIST_GRIMOIRE.md
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ParsedTitle {
  // FIRE: Card Identification
  cardId: string | null;
  setCode: string | null;
  cardNumber: string | null;

  // AIR: Variant Essence
  variant: VariantType;

  // WATER: Language
  language: LanguageCode;

  // EARTH: Physical State
  isGraded: boolean;
  gradingCompany: string | null;
  grade: number | null;

  // Metadata
  rawTitle: string;
  confidence: number;
  extractedCharacter: string | null;
}

export type VariantType =
  | 'standard'
  | 'parallel'
  | 'sp'
  | 'sec'
  | 'manga'
  | 'leader'
  | 'boxtopper'
  | 'wantedposter'
  | 'promo';

export type LanguageCode = 'EN' | 'JP' | 'DE' | 'FR' | 'IT' | 'ES' | 'PT' | 'KO' | 'ZH';

// =============================================================================
// FIRE: CARD ID RUNES
// =============================================================================

/**
 * Sacred patterns to extract Card IDs from titles.
 * Ordered by specificity (most specific first).
 */
const CARD_ID_RUNES: RegExp[] = [
  // SP format: OP05-SP-OP01-121 or EB02-SP-OP06-042
  /\b(OP\d{2}|EB\d{2})-SP-(OP\d{2}|EB\d{2})-(\d{3})\b/i,

  // Standard with variant suffix: OP01-120-parallel
  /\b(OP\d{2}|EB\d{2}|ST\d{2})-(\d{3})-[a-z]+\b/i,

  // Standard: OP01-120, EB02-061, ST16-004
  /\b(OP\d{2}|EB\d{2}|ST\d{2})-(\d{3})\b/i,

  // With spaces: OP01 - 120
  /\b(OP\d{2}|EB\d{2}|ST\d{2})\s*-\s*(\d{3})\b/i,

  // Without dash (rare): OP01120
  /\b(OP\d{2}|EB\d{2}|ST\d{2})(\d{3})\b/i,

  // Promo cards: P-001, PRB01-001
  /\b(P|PRB\d{2})-(\d{3})\b/i,
];

// =============================================================================
// AIR: VARIANT RUNES
// =============================================================================

/**
 * Patterns to detect variant types from titles.
 * Order matters - more specific patterns first.
 */
const VARIANT_RUNES: Array<{ type: VariantType; pattern: RegExp; priority: number }> = [
  // Most specific first
  { type: 'manga', pattern: /\b(manga\s*art|manga)\b/i, priority: 1 },
  { type: 'wantedposter', pattern: /\bwanted\s*poster\b/i, priority: 1 },
  { type: 'boxtopper', pattern: /\b(box\s*topper|boxtop)\b/i, priority: 1 },
  { type: 'sec', pattern: /\b(SEC|secret\s*rare)\b/i, priority: 2 },
  { type: 'sp', pattern: /\b(SP|special\s*rare)\b/i, priority: 2 },
  { type: 'leader', pattern: /\bleader\s*(alt\s*art|parallel)?\b/i, priority: 3 },
  { type: 'parallel', pattern: /\b(parallel|alt\s*art|alternate\s*art|AA)\b/i, priority: 4 },
  { type: 'promo', pattern: /\b(promo|promotional)\b/i, priority: 5 },
];

// =============================================================================
// WATER: LANGUAGE RUNES
// =============================================================================

const LANGUAGE_RUNES: Array<{ code: LanguageCode; pattern: RegExp }> = [
  { code: 'EN', pattern: /\b(english|eng|EN)\b/i },
  { code: 'JP', pattern: /\b(japanese|japan|JP|JPN|JAP)\b/i },
  { code: 'DE', pattern: /\b(german|deutsch|DE|GER)\b/i },
  { code: 'FR', pattern: /\b(french|francais|FR|FRA)\b/i },
  { code: 'IT', pattern: /\b(italian|italiano|IT|ITA)\b/i },
  { code: 'ES', pattern: /\b(spanish|espanol|ES|ESP)\b/i },
  { code: 'PT', pattern: /\b(portuguese|portugues|PT|POR)\b/i },
  { code: 'KO', pattern: /\b(korean|KO|KOR)\b/i },
  { code: 'ZH', pattern: /\b(chinese|mandarin|ZH|CHN|CHI)\b/i },
];

// =============================================================================
// EARTH: GRADING RUNES
// =============================================================================

const GRADING_RUNES = {
  // Detect if card is graded (we exclude these for raw training data)
  isGraded: /\b(PSA|CGC|BGS|Beckett|graded|slab(?:bed)?)\b/i,

  // Extract grading company
  company: /\b(PSA|CGC|BGS|Beckett|SGC|ACE|GMA)\b/i,

  // Extract numeric grade
  grade: /\b(PSA|CGC|BGS|SGC)\s*(\d{1,2}(?:\.\d)?)\b/i,
};

// =============================================================================
// CHARACTER EXTRACTION
// =============================================================================

/**
 * Known One Piece character names for extraction.
 * Helps improve confidence when character matches card.
 */
const CHARACTER_PATTERNS: Array<{ name: string; aliases: RegExp }> = [
  { name: 'Shanks', aliases: /\b(shanks|red[- ]?hair(?:ed)?)\b/i },
  { name: 'Yamato', aliases: /\byamato\b/i },
  { name: 'Luffy', aliases: /\b(luffy|monkey\s*d\.?\s*luffy|straw\s*hat)\b/i },
  { name: 'Zoro', aliases: /\b(zoro|roronoa\s*zoro)\b/i },
  { name: 'Nami', aliases: /\bnami\b/i },
  { name: 'Sanji', aliases: /\bsanji\b/i },
  { name: 'Ace', aliases: /\b(ace|portgas\s*d\.?\s*ace)\b/i },
  { name: 'Law', aliases: /\b(law|trafalgar\s*(?:d\.?\s*water\s*)?law)\b/i },
  { name: 'Boa Hancock', aliases: /\b(boa\s*hancock|hancock)\b/i },
  { name: 'Kaido', aliases: /\bkaido\b/i },
  { name: 'Doflamingo', aliases: /\b(doflamingo|doffy|donquixote)\b/i },
  { name: 'Katakuri', aliases: /\b(katakuri|charlotte\s*katakuri)\b/i },
  { name: 'Crocodile', aliases: /\bcrocodile\b/i },
  { name: 'Eustass Kid', aliases: /\b(kid|eustass\s*(?:"captain")?\s*kid)\b/i },
  { name: 'Robin', aliases: /\b(robin|nico\s*robin)\b/i },
  { name: 'Chopper', aliases: /\b(chopper|tony\s*tony\s*chopper)\b/i },
  { name: 'Whitebeard', aliases: /\b(whitebeard|edward\s*newgate)\b/i },
  { name: 'Big Mom', aliases: /\b(big\s*mom|charlotte\s*linlin)\b/i },
  { name: 'Blackbeard', aliases: /\b(blackbeard|teach|marshall\s*d\.?\s*teach)\b/i },
  { name: 'Sabo', aliases: /\bsabo\b/i },
];

// =============================================================================
// MAIN PARSER CLASS
// =============================================================================

export class TitleParser {
  /**
   * Parse an eBay listing title into its elemental components.
   *
   * @example
   * ```typescript
   * const parser = new TitleParser();
   * const result = parser.parse("OP01-120 Shanks Alt Art Romance Dawn English");
   * // { cardId: "OP01-120", variant: "parallel", language: "EN", ... }
   * ```
   */
  parse(title: string): ParsedTitle {
    const result: ParsedTitle = {
      cardId: null,
      setCode: null,
      cardNumber: null,
      variant: 'standard',
      language: 'EN', // Default to English
      isGraded: false,
      gradingCompany: null,
      grade: null,
      rawTitle: title,
      confidence: 0.5,
      extractedCharacter: null,
    };

    // FIRE: Extract Card ID
    this.extractCardId(title, result);

    // AIR: Detect Variant
    this.extractVariant(title, result);

    // WATER: Detect Language
    this.extractLanguage(title, result);

    // EARTH: Check Grading Status
    this.extractGradingInfo(title, result);

    // Character Extraction
    this.extractCharacter(title, result);

    // Calculate Confidence
    result.confidence = this.calculateConfidence(result);

    return result;
  }

  /**
   * Parse multiple titles in batch.
   */
  parseBatch(titles: string[]): ParsedTitle[] {
    return titles.map((title) => this.parse(title));
  }

  // ===========================================================================
  // FIRE: Card ID Extraction
  // ===========================================================================

  private extractCardId(title: string, result: ParsedTitle): void {
    for (const rune of CARD_ID_RUNES) {
      const match = title.match(rune);
      if (match) {
        // Handle SP format specially
        if (rune.source.includes('SP')) {
          // OP05-SP-OP01-121 → cardId = OP01-121, but note it's an SP from OP05
          result.setCode = match[3]?.toUpperCase() || match[1].toUpperCase();
          result.cardNumber = match[4] || match[2];
        } else {
          result.setCode = match[1].toUpperCase();
          result.cardNumber = match[2];
        }

        result.cardId = `${result.setCode}-${result.cardNumber}`;
        return;
      }
    }
  }

  // ===========================================================================
  // AIR: Variant Extraction
  // ===========================================================================

  private extractVariant(title: string, result: ParsedTitle): void {
    // Sort by priority to check more specific patterns first
    const sortedRunes = [...VARIANT_RUNES].sort((a, b) => a.priority - b.priority);

    for (const { type, pattern } of sortedRunes) {
      if (pattern.test(title)) {
        result.variant = type;
        return;
      }
    }

    // Default: standard (no variant detected)
    result.variant = 'standard';
  }

  // ===========================================================================
  // WATER: Language Extraction
  // ===========================================================================

  private extractLanguage(title: string, result: ParsedTitle): void {
    for (const { code, pattern } of LANGUAGE_RUNES) {
      if (pattern.test(title)) {
        result.language = code;
        return;
      }
    }

    // Heuristics for language detection when not explicit
    // Japanese character detection
    if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(title)) {
      result.language = 'JP';
      return;
    }

    // Default to English
    result.language = 'EN';
  }

  // ===========================================================================
  // EARTH: Grading Info Extraction
  // ===========================================================================

  private extractGradingInfo(title: string, result: ParsedTitle): void {
    result.isGraded = GRADING_RUNES.isGraded.test(title);

    if (result.isGraded) {
      // Extract company
      const companyMatch = title.match(GRADING_RUNES.company);
      if (companyMatch) {
        result.gradingCompany = companyMatch[1].toUpperCase();
      }

      // Extract grade
      const gradeMatch = title.match(GRADING_RUNES.grade);
      if (gradeMatch) {
        result.grade = parseFloat(gradeMatch[2]);
      }
    }
  }

  // ===========================================================================
  // Character Extraction
  // ===========================================================================

  private extractCharacter(title: string, result: ParsedTitle): void {
    for (const { name, aliases } of CHARACTER_PATTERNS) {
      if (aliases.test(title)) {
        result.extractedCharacter = name;
        return;
      }
    }
  }

  // ===========================================================================
  // Confidence Calculation
  // ===========================================================================

  private calculateConfidence(result: ParsedTitle): number {
    let confidence = 0.5; // Base confidence

    // FIRE: Card ID extracted (+0.20)
    if (result.cardId) {
      confidence += 0.20;
    }

    // AIR: Variant explicitly detected (+0.15)
    if (result.variant !== 'standard') {
      confidence += 0.15;
    }

    // WATER: Language explicitly in title (+0.10)
    // We already set language, but check if it was explicit
    const hasExplicitLanguage = LANGUAGE_RUNES.some(({ pattern }) =>
      pattern.test(result.rawTitle)
    );
    if (hasExplicitLanguage) {
      confidence += 0.10;
    }

    // Character match (+0.05)
    if (result.extractedCharacter) {
      confidence += 0.05;
    }

    // Penalty: Graded cards are less useful for raw training (-0.10)
    if (result.isGraded) {
      confidence -= 0.10;
    }

    return Math.max(0, Math.min(1, confidence));
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a title should be excluded from training data.
 */
export function shouldExclude(parsed: ParsedTitle): boolean {
  // Exclude graded cards (images have slabs)
  if (parsed.isGraded) {
    return true;
  }

  // Exclude if no card ID could be extracted
  if (!parsed.cardId) {
    return true;
  }

  // Exclude very low confidence
  if (parsed.confidence < 0.4) {
    return true;
  }

  return false;
}

/**
 * Get a deduplication key for a parsed title.
 */
export function getDedupeKey(parsed: ParsedTitle): string {
  return `${parsed.cardId}|${parsed.variant}|${parsed.language}`;
}

/**
 * Create a singleton parser instance.
 */
export const titleParser = new TitleParser();
