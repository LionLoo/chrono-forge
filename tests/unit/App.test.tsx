import { render, screen } from '@testing-library/react';
import { App } from '../../src/App';
import { PROJECT_META } from '../../src/project-meta';

describe('bootstrap application shell', () => {
  it('identifies the product promise and honest foundation status', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: PROJECT_META.promise })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Repository foundation active');
    expect(screen.getByText(/Playable civilization systems begin/i)).toBeVisible();
  });

  it('exposes every foundation system as readable content', () => {
    render(<App />);

    for (const label of ['Simulation', 'Rendering', 'Persistence', 'Validation']) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });
});
