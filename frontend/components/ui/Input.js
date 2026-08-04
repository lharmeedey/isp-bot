'use client';

import { forwardRef } from 'react';

/**
 * Input + Field helpers reusing the .input / .label primitives so all forms
 * share one look. Field wraps a labelled control with an optional hint.
 */
export const Input = forwardRef(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`input ${className}`} {...props} />;
});

export function Field({ label, htmlFor, hint, children }) {
  return (
    <div>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export default Input;
