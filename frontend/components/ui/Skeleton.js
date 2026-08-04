'use client';

// Skeleton — shimmer placeholder. Pass Tailwind sizing via className.
export default function Skeleton({ className = 'h-4 w-full' }) {
  return <div className={`skeleton ${className}`} />;
}
