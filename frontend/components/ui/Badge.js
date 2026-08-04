'use client';

/**
 * Badge — small status pill. tone: 'success' | 'muted' | 'accent'
 */
export default function Badge({ children, tone = 'muted', className = '' }) {
  const cls =
    tone === 'success' ? 'badge-success' :
    tone === 'accent'  ? 'badge-accent' :
                         'badge-muted';
  return <span className={`${cls} ${className}`}>{children}</span>;
}
