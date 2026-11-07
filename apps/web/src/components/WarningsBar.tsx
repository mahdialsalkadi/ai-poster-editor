import { useState } from 'react';
import type { Warning } from '@poster/core';
import { Icon } from './icons.js';

/**
 * Non-blocking report of everything the strict parser dropped, clamped, or
 * substituted. Warnings are the product's honesty layer: the design still
 * loads, but the user can see exactly what changed.
 */
export function WarningsBar({
  warnings,
  onDismiss,
}: {
  warnings: readonly Warning[];
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (warnings.length === 0) return null;
  const visible = open ? warnings : warnings.slice(0, 2);

  return (
    <div className={`warnings-bar${open ? ' is-open' : ''}`}>
      <div className="warnings-head">
        <button
          type="button"
          className="warnings-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <Icon name="warning" size={16} />
          <span>
            {warnings.length === 1
              ? 'تنبيه واحد من المستورد'
              : `${warnings.length} تنبيهات من المستورد`}
          </span>
          <Icon name="chevronDown" size={14} className="warnings-chevron" />
        </button>
        <button
          type="button"
          className="warnings-dismiss"
          onClick={onDismiss}
          aria-label="إخفاء التنبيهات"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <ul className="warnings-list">
        {visible.map((warning, index) => (
          <li key={`${warning.code}-${warning.path}-${index}`} className="warning-item">
            <code>{warning.code}</code>
            <span>{warning.message}</span>
            {warning.layerId ? <em>{warning.layerId}</em> : null}
          </li>
        ))}
        {!open && warnings.length > 2 ? (
          <li className="warning-more">+{warnings.length - 2} أخرى…</li>
        ) : null}
      </ul>
    </div>
  );
}
