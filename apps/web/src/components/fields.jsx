// Form fields, ported from the mockup's `.field` block.
//
// No form library: every form here is 3-6 fields, and useState plus a
// validate() function is smaller than react-hook-form's API surface.

export function Field({ label, hint, error, htmlFor, children }) {
  return (
    <div className="field">
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? <div className="error">{error}</div> : null}
      {hint && !error ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function TextInput({ label, hint, error, value, onChange, id, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </Field>
  );
}

export function NumberInput({ label, hint, error, value, onChange, id, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </Field>
  );
}

export function TextArea({ label, hint, error, value, onChange, id, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <textarea id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

// options: [{ value, label }]
export function Select({ label, hint, error, value, onChange, options, placeholder, id, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function DateInput({ label, hint, error, value, onChange, id, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </Field>
  );
}
