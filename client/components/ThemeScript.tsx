/**
 * Applies the stored theme before the page paints.
 *
 * This has to run as a blocking inline script rather than in an effect: a
 * React effect runs after the first paint, which would show a white flash to
 * anyone using dark mode. The script only reads localStorage and toggles a
 * class, so there is nothing here for a user to inject into.
 */
export default function ThemeScript() {
  const script = `
    (function () {
      try {
        var stored = localStorage.getItem('theme');
        var dark = stored === 'dark' ||
          ((!stored || stored === 'system') &&
            window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (dark) document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
