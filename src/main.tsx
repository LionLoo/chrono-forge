import './styles.css';

async function start(): Promise<void> {
  if (new URLSearchParams(globalThis.location.search).has('persistence-broker')) {
    const { startPersistenceBroker } = await import('./persistence-broker');
    await startPersistenceBroker();
    return;
  }

  const [{ StrictMode }, { createRoot }, { App }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('./App'),
  ]);

  if (import.meta.env.MODE === 'desktop-e2e') {
    await import('./wdio-bootstrap');
  }

  const root = document.querySelector<HTMLDivElement>('#root');

  if (!root) {
    throw new Error('Chrono Forge root element is missing.');
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
