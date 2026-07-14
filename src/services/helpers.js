// Format naira amounts
function naira(amount) {
  return `₦${Number(amount).toLocaleString('en-NG')}`;
}

// Format GB with smart decimal
function gb(value) {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  return num % 1 === 0 ? `${num}GB` : `${num.toFixed(1)}GB`;
}

// Format date nicely
function date(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-NG', {
    day:   'numeric',
    month: 'short',
    year:  'numeric',
  });
}

// Minutes since last sync
function syncAge(user) {
  if (!user?.last_sync) return 'unknown';
  const mins = Math.floor((Date.now() - new Date(user.last_sync)) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// Usage percentage bar (10 chars)
function usageBar(remaining, total) {
  if (!total || total === 0) return '──────────';
  const pct    = Math.min(remaining / total, 1);
  const filled = Math.round(pct * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// Plan selection inline keyboard
function planKeyboard(plans) {
  return plans.map(p => ([{
    text:          `${p.label}  —  ${naira(p.price)}  (${p.validity})`,
    callback_data: `plan_${p.id}`,
  }]));
}

module.exports = { naira, gb, date, syncAge, usageBar, planKeyboard };