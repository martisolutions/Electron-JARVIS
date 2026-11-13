type IconProps = { size?: number };

export function SettingsIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </svg>
  );
}

export function MicIcon({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v2.5M9 20.5h6" />
    </svg>
  );
}

export function SendIcon({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}

export function StopIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

export function AttachmentIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.8 12.6l6.1-6.1a3 3 0 1 1 4.2 4.2l-7.7 7.7a5 5 0 1 1-7.1-7.1l7.3-7.3" />
    </svg>
  );
}

export function CloseIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function PowerIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M12 3.5v8" />
      <path d="M6.2 6.6a8 8 0 1 0 11.6 0" />
    </svg>
  );
}

export function SparkIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

export function BoardIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="7" height="6" rx="1.2" />
      <rect x="13.5" y="4.5" width="7" height="6" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="6" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="6" rx="1.2" />
    </svg>
  );
}

export function ChatIcon({ size = 15 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5.5h14v10H9l-4 3.5V5.5Z" />
      <path d="M8.5 9h7M8.5 12h4.5" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 11v5M14 11v5" />
    </svg>
  );
}

export function EditIcon({ size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 19.5h4L19 9l-4-4L4.5 15.5v4Z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
