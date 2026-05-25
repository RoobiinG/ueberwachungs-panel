const variants = {
  primary: 'bg-panel-accent hover:bg-blue-600 text-white',
  danger: 'bg-panel-red hover:bg-red-600 text-white',
  success: 'bg-panel-green hover:bg-green-600 text-white',
  ghost: 'bg-transparent hover:bg-panel-surface text-panel-text border border-panel-border',
  warning: 'bg-panel-orange hover:bg-yellow-600 text-black',
};

const sizes = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-sm',
};

export const Button = ({ children, variant = 'primary', size = 'md', className = '', disabled, onClick, type = 'button' }) => (
  <button
    type={type}
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex items-center justify-center gap-1 ${variants[variant]} ${sizes[size]} rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
  >
    {children}
  </button>
);
