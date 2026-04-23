import React, { useEffect } from 'react';

export function ResponsivePageHeader({ title, subtitle, right, className = '' }) {
  return (
    <div className={`rph ${className}`.trim()}>
      <div className="rph-main">
        <h2 className="rph-title">{title}</h2>
        {subtitle ? <p className="rph-sub">{subtitle}</p> : null}
      </div>
      {right ? <div className="rph-right">{right}</div> : null}
    </div>
  );
}

export function ResponsiveCard({ children, className = '', ...rest }) {
  return <div className={`rcard ${className}`.trim()} {...rest}>{children}</div>;
}

export function ResponsiveFormSection({ title, subtitle, children, className = '' }) {
  return (
    <section className={`rform-section ${className}`.trim()}>
      {(title || subtitle) && (
        <header className="rform-head">
          {title ? <h3 className="rform-title">{title}</h3> : null}
          {subtitle ? <p className="rform-sub">{subtitle}</p> : null}
        </header>
      )}
      <div className="rform-body">{children}</div>
    </section>
  );
}

export function ResponsiveDataList({ items = [], renderItem, empty, className = '' }) {
  if (!items.length) return empty || null;
  return <div className={`rdata-list ${className}`.trim()}>{items.map(renderItem)}</div>;
}

export function ResponsiveTableOrCards({
  mobile,
  desktop,
  isMobile,
}) {
  return isMobile ? mobile : desktop;
}

export function BottomSheet({ open, onClose, title, children, className = '' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="rsheet-overlay" onClick={onClose}>
      <div className={`rsheet ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
        <div className="rsheet-handle" />
        {title ? <div className="rsheet-title">{title}</div> : null}
        <div className="rsheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ActionMenu({ trigger, children, className = '' }) {
  return (
    <details className={`raction-menu ${className}`.trim()}>
      <summary className="raction-trigger">
        {trigger || (
          <span aria-label="Действия" title="Действия">⋯</span>
        )}
      </summary>
      <div className="raction-list">{children}</div>
    </details>
  );
}

export function MobileStickyActions({ children, className = '' }) {
  return <div className={`rmobile-sticky-actions ${className}`.trim()}>{children}</div>;
}

