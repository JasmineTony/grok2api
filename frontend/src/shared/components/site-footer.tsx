export function SiteFooter() {
  return (
    <footer className="flex min-h-12 items-center justify-end gap-1.5 border-t border-border/50 px-5 text-right text-[11px] text-muted-foreground sm:px-8">
      <a
        className="transition-colors hover:text-foreground"
        href="https://github.com/JasmineTony/grok2api"
        target="_blank"
        rel="noreferrer"
      >
        Grok2API
      </a>
      <span>© 2026</span>
      <span aria-hidden="true">·</span>
      <a
        className="transition-colors hover:text-foreground"
        href="https://github.com/JasmineTony"
        target="_blank"
        rel="noreferrer"
      >
        JasmineTony
      </a>
      <span aria-hidden="true">·</span>
      <a
        className="transition-colors hover:text-foreground"
        href="https://github.com/chenyme/grok2api"
        target="_blank"
        rel="noreferrer"
      >
        Upstream
      </a>
    </footer>
  );
}
