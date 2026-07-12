/**
 * USDC brand mark, inlined as SVG so it renders offline with no external request
 * (the wallet is a self-contained PWA under a strict CSP). Blue disc + white
 * dollar glyph + the two characteristic ring arcs.
 */
export function UsdcMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="USDC"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path
        fill="#fff"
        d="M20.5 18.5c0-2.4-1.4-3.2-4.3-3.5-2-.3-2.4-.8-2.4-1.7 0-.9.6-1.4 1.9-1.4 1.1 0 1.7.4 2 1.3.1.2.3.4.5.4h1c.3 0 .5-.2.5-.5v-.1c-.3-1.4-1.4-2.4-2.9-2.6v-1.4c0-.3-.2-.5-.5-.5h-.9c-.3 0-.5.2-.5.5v1.3c-2 .3-3.2 1.6-3.2 3.2 0 2.3 1.4 3.1 4.2 3.4 1.9.3 2.5.7 2.5 1.8 0 1.1-.9 1.7-2.2 1.7-1.7 0-2.3-.7-2.5-1.6-.1-.3-.3-.4-.5-.4h-1.1c-.3 0-.5.2-.5.5v.1c.3 1.6 1.3 2.7 3.5 3v1.4c0 .3.2.5.5.5h.9c.3 0 .5-.2.5-.5v-1.4c2-.3 3.3-1.7 3.3-3.4z"
      />
      <path
        fill="#fff"
        d="M12.9 24.6c-3.5-1.3-5.3-5.2-4-8.7.7-1.9 2.1-3.3 4-4 .2-.1.3-.3.3-.5v-.9c0-.2-.1-.4-.3-.4-.1 0-.2 0-.3.1-4.2 1.3-6.5 5.8-5.2 10 .8 2.5 2.7 4.4 5.2 5.2.2.1.4 0 .5-.2.1-.1.1-.2.1-.3v-.9c0-.2-.2-.4-.3-.5zm6.5-14.5c-.2-.1-.4 0-.5.2-.1.1-.1.2-.1.3v.9c0 .2.2.4.3.5 3.5 1.3 5.3 5.2 4 8.7-.7 1.9-2.1 3.3-4 4-.2.1-.3.3-.3.5v.9c0 .2.1.4.3.4.1 0 .2 0 .3-.1 4.2-1.3 6.5-5.8 5.2-10-.8-2.6-2.8-4.5-5.2-5.3z"
      />
    </svg>
  );
}
