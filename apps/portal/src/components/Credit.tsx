/**
 * Geliştirici künyesi (docs/08 §3.13) — pazarlama sitesi, büro paneli ve
 * yönetim panelindekiyle aynı biçim ve aynı bağlantı özellikleri.
 */
export function Credit({ className = "" }: { className?: string }) {
  return (
    <p className={`credit text-ink-soft ${className}`}>
      <a href="https://mindaeon.com" target="_blank" rel="noopener noreferrer">
        Developed by MindAeon AI
      </a>
    </p>
  );
}
