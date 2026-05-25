export const Card = ({ children, className = '', title, action }) => (
  <div className={`bg-panel-card border border-panel-border rounded-lg ${className}`}>
    {title && (
      <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border">
        <h3 className="text-sm font-semibold text-panel-text">{title}</h3>
        {action && <div>{action}</div>}
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);
