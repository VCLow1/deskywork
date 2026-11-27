// components/common/TunisianPhoneInput.jsx — Champ téléphone tunisien strict avec masque +216 XX XXX XXX
import React, { useState, useEffect } from 'react';
import { formatTunisianPhone, validateTunisianPhone } from '../../utils/tunisianPhone';

export default function TunisianPhoneInput({
  value = '',
  onChange,
  required = false,
  disabled = false,
  placeholder = '+216 20 123 456',
  className = '',
  id,
  name,
  error: externalError = '',
  onValidationChange = null,
}) {
  const [displayValue, setDisplayValue] = useState(() => formatTunisianPhone(value));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setDisplayValue(formatTunisianPhone(value));
  }, [value]);

  const check = validateTunisianPhone(displayValue, { required });
  const visibleError = externalError || (touched && !check.valid ? check.error : '');

  const handleChange = (e) => {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setDisplayValue('');
      onChange?.('');
      onValidationChange?.(validateTunisianPhone('', { required }));
      return;
    }
    const formatted = formatTunisianPhone(raw);
    setDisplayValue(formatted);
    const v = validateTunisianPhone(formatted, { required });
    onChange?.(v.valid && v.normalized ? v.normalized : formatted);
    onValidationChange?.(v);
  };

  const handleBlur = () => {
    setTouched(true);
    const v = validateTunisianPhone(displayValue, { required });
    onValidationChange?.(v);
    if (v.valid && v.normalized) {
      setDisplayValue(formatTunisianPhone(v.normalized));
      onChange?.(v.normalized);
    }
  };

  return (
    <div className="w-full">
      <div className="relative">
        <input
          id={id}
          name={name}
          type="tel"
          inputMode="numeric"
          required={required}
          disabled={disabled}
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          aria-invalid={Boolean(visibleError)}
          className={`${className} ${
            visibleError ? '!border-red-500 focus:!ring-red-500/20' : ''
          }`}
        />
      </div>
      {visibleError && (
        <p className="text-xs font-semibold text-red-600 mt-1 flex items-center gap-1">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>error</span>
          <span>{visibleError}</span>
        </p>
      )}
    </div>
  );
}
