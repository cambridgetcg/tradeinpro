/**
 * Clean Card Names Script
 *
 * Updates card names in card_prices_v2 to format: "Character Name Variant"
 * - Removes card numbers in parentheses like (034), (002)
 * - Removes variant descriptors already in name like (Parallel), (Manga)
 * - Appends readable variant type from variant_type column
 *
 * Run with: node scripts/clean-card-names.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Map variant_type values to display names
const VARIANT_DISPLAY_NAMES = {
  'parallel': 'Parallel',
  'sp': 'SP',
  'spr': 'SPR',
  'boxtopper': 'Box Topper',
  'wantedposter': 'Wanted Poster',
  'manga': 'Manga',
  'manga-altart': 'Manga Alt Art',
  'tr': 'Treasure Rare',
  'dashpack': 'Dash Pack',
  'manga-parallel': 'Manga Parallel',
  'sp-silver': 'SP Silver',
  'sp-gold': 'SP Gold',
  'manga-parallel-altart': 'Manga Parallel Alt Art',
  'sp-wantedposter': 'SP Wanted Poster',
  'altart-gold': 'Alt Art Gold',
};

/**
 * Clean a card name by removing card numbers and existing variant descriptors
 */
function cleanCardName(name) {
  let cleaned = name;

  // Remove card numbers in parentheses like (034), (002), (001), (119), etc.
  // These are 3-digit numbers
  cleaned = cleaned.replace(/\s*\(\d{3}\)\s*/g, '');

  // Remove card numbers with set prefix like " - OP09-119", " - EB02-028"
  cleaned = cleaned.replace(/\s*-\s*(OP|ST|EB)\d{2}-\d{3}\s*/gi, '');

  // Remove variant descriptors that might already be in the name
  // But keep character nicknames like "Mr. 1 (Daz.Bonez)", "Mr.2.Bon.Kurei (Bentham)"
  const variantPatterns = [
    /\s*\(Parallel\)\s*/gi,
    /\s*\(Manga\)\s*/gi,
    /\s*\(Alternate Art\)\s*/gi,
    /\s*\(Alt Art\)\s*/gi,
    /\s*\(SP\)\s*/gi,
    /\s*\(SPR\)\s*/gi,
    /\s*\(Box Topper\)\s*/gi,
    /\s*\(Treasure Rare\)\s*/gi,
    /\s*\(Wanted Poster\)\s*/gi,
    /\s*\(Dash Pack\)\s*/gi,
  ];

  for (const pattern of variantPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up dots in names for better readability
  // Handle ".D." pattern specifically (middle initial)
  // e.g., "Monkey.D.Luffy" → "Monkey D. Luffy"
  // e.g., "Portgas.D.Ace" → "Portgas D. Ace"
  cleaned = cleaned.replace(/\.D\./g, ' D. ');

  // Don't change other dot patterns like "Edward.Newgate" - these are intentional
  // The API uses dots as name separators in some cases

  // Fix double spaces
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Trim any extra whitespace
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Get the display name for a variant type
 */
function getVariantDisplayName(variantType) {
  if (!variantType) return null;
  return VARIANT_DISPLAY_NAMES[variantType.toLowerCase()] || variantType;
}

/**
 * Build the final display name
 */
function buildDisplayName(baseName, variantType) {
  const cleanedName = cleanCardName(baseName);
  const variantDisplay = getVariantDisplayName(variantType);

  if (variantDisplay) {
    return `${cleanedName} ${variantDisplay}`;
  }
  return cleanedName;
}

async function main() {
  console.log('Starting card name cleanup...\n');

  // Get all cards
  const cards = await prisma.cardPriceV2.findMany({
    select: {
      cardId: true,
      name: true,
      variantType: true,
    }
  });

  console.log(`Found ${cards.length} cards to process\n`);

  // Preview mode - show what would change
  const changes = [];

  for (const card of cards) {
    const newName = buildDisplayName(card.name, card.variantType);

    if (newName !== card.name) {
      changes.push({
        cardId: card.cardId,
        oldName: card.name,
        newName: newName,
        variantType: card.variantType,
      });
    }
  }

  console.log(`Found ${changes.length} cards that need name updates:\n`);

  // Group changes by variant type for better preview
  const byVariant = {};
  for (const change of changes) {
    const vt = change.variantType || 'unknown';
    if (!byVariant[vt]) byVariant[vt] = [];
    byVariant[vt].push(change);
  }

  // Show preview with samples from each variant type
  console.log('Preview of changes (samples by variant type):');
  console.log('='.repeat(120));

  for (const [variant, variantChanges] of Object.entries(byVariant)) {
    console.log(`\n${variant.toUpperCase()} (${variantChanges.length} cards):`);
    variantChanges.slice(0, 3).forEach(change => {
      console.log(`  ${change.cardId.padEnd(32)} | "${change.oldName}" → "${change.newName}"`);
    });
  }
  console.log('\n' + '='.repeat(120));

  // Check if --apply flag is passed
  if (process.argv.includes('--apply')) {
    console.log('\nApplying changes...');

    let updated = 0;
    for (const change of changes) {
      await prisma.cardPriceV2.update({
        where: { cardId: change.cardId },
        data: { name: change.newName },
      });
      updated++;

      if (updated % 50 === 0) {
        console.log(`  Updated ${updated}/${changes.length} cards...`);
      }
    }

    console.log(`\nDone! Updated ${updated} card names.`);
  } else {
    console.log('\nThis was a preview. Run with --apply to make changes:');
    console.log('  node scripts/clean-card-names.js --apply');
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
