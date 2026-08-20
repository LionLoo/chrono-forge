import { PROJECT_META } from './project-meta';

const foundationItems = [
  ['Simulation', 'Deterministic worker boundary'],
  ['Rendering', 'PixiJS projection layer'],
  ['Persistence', 'Tauri + SQLite generations'],
  ['Validation', 'Unit, invariant, E2E, and release gates'],
] as const;

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Chrono Forge home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>{PROJECT_META.name}</span>
        </a>
        <span className="build-badge">v{PROJECT_META.version} · foundation</span>
      </header>

      <main id="main" className="foundation" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <div className="eyebrow">The forge is being prepared</div>
          <h1 id="hero-title">{PROJECT_META.promise}</h1>
          <p>
            The durable repository, deterministic simulation boundary, desktop runtime, and release
            gates are online. Playable civilization systems begin after this verified foundation is
            merged.
          </p>
          <div className="status-row" role="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {PROJECT_META.stage} active
          </div>
        </section>

        <section className="world-preview" aria-label="Stylized Chrono Forge landscape preview">
          <div className="sun" />
          <div className="mountain mountain-far" />
          <div className="mountain mountain-near" />
          <div className="river" />
          <div className="forge-tower">
            <span />
          </div>
          <div className="grain grain-one" />
          <div className="grain grain-two" />
          <div className="grain grain-three" />
        </section>

        <section className="foundation-grid" aria-label="Foundation systems">
          {foundationItems.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
