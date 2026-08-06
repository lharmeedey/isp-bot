'use strict';

/**
 * Generate a URL-safe slug from a business name. Handles collisions by
 * appending a counter. Used for customer-facing store URLs.
 *
 * Examples:
 *   "Acme WiFi"     → "acme-wifi"
 *   "Naija Hotspot" → "naija-hotspot"
 *   "WiFi+More!"    → "wifi-more"
 */

/**
 * Slugify a string: lowercase, ASCII-fold, strip non-alphanumeric, collapse
 * spaces → dashes. Empty result → "store".
 */
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')                   // decompose accents
    .replace(/[̀-ͯ]/g, '')    // strip combining marks
    .replace(/[^a-z0-9\s-]/g, '')       // keep only letters, digits, spaces, dashes
    .trim()
    .replace(/\s+/g, '-')               // spaces → single dash
    .replace(/-+/g, '-')                // collapse multiple dashes
    .replace(/^-|-$/g, '')              // strip leading/trailing dashes
    || 'store';
}

/**
 * Generate a unique slug for a business name. Checks the tenants table and
 * appends a counter (-2, -3, ...) on collision.
 *
 * @param {string} businessName
 * @param {object} client - pg client for transaction-safe queries
 * @returns {Promise<string>} unique slug
 */
async function generateUniqueSlug(businessName, client) {
  const base = slugify(businessName);
  let candidate = base;
  let suffix = 1;

  for (let i = 0; i < 20; i++) {
    const taken = await client.query(
      'SELECT 1 FROM tenants WHERE slug = $1',
      [candidate]
    );
    if (!taken.rows.length) return candidate;

    suffix++;
    candidate = `${base}-${suffix}`;
  }

  // Fallback after 20 tries: append random hex to guarantee uniqueness.
  const rand = Math.random().toString(36).slice(2, 6);
  return `${base}-${rand}`;
}

module.exports = { slugify, generateUniqueSlug };
