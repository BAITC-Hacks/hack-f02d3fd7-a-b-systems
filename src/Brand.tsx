type BrandLockupProps = { inverse?: boolean; compact?: boolean };

export function BrandLockup({ inverse = false, compact = false }: BrandLockupProps) {
  return <div className={`brand-lockup${compact ? ' brand-lockup-compact' : ''}`}>
    <img
      src={inverse ? '/brand/halyk-logo-white.svg' : '/brand/halyk-logo.svg'}
      alt="Halyk"
      width="165"
      height="58"
    />
    <span className="brand-product">Career Quest</span>
    {!compact && <span className="brand-caption">Карьерный навигатор сотрудников</span>}
  </div>;
}
