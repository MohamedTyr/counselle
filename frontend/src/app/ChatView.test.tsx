/**
 * FE-H5 placement regression: the in-conversation message tree must stay inside
 * MessagesErrorBoundary so one bad message render cannot blank the chat pane.
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import ChatView from '@/app/ChatView';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ conversationId: 'conversation-1' }),
}));

vi.mock('@/app/ChatContext', () => ({
  useChatContext: () => ({ messages: [{ id: 'm1' }] }),
}));

vi.mock('@librechat/client', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <section data-testid="panel-group">{children}</section>
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <section data-testid="panel">{children}</section>
  ),
  ResizableHandle: () => <div data-testid="panel-handle" />,
}));

vi.mock('~/components/Chat/Messages/MessagesView', () => ({
  default: () => {
    throw new Error('message render failed');
  },
}));

vi.mock('~/components/Chat/Landing', () => ({ default: () => <div>landing</div> }));
vi.mock('~/components/Chat/Header', () => ({ default: () => <header>header</header> }));
vi.mock('~/components/Chat/Footer', () => ({ default: () => <footer>footer</footer> }));
vi.mock('@/components/composer/ChatComposer', () => ({ default: () => <form>composer</form> }));
vi.mock('@/components/composer/SuggestionPills', () => ({ default: () => <div>suggestions</div> }));
vi.mock('@/components/background/EtherealShadow', () => ({ default: () => <div>shadow</div> }));
vi.mock('@/components/artifact/ArtifactPanel', () => ({
  ARTIFACT_HANDLE_CLASS: 'artifact-handle',
  ArtifactPanel: () => <aside>artifact panel</aside>,
  ArtifactSheet: () => <aside>artifact sheet</aside>,
}));
vi.mock('@/components/citations/SourcesPanel', () => ({
  SourcesPanel: () => <aside>sources panel</aside>,
  SourcesSheet: () => <aside>sources sheet</aside>,
}));

describe('ChatView error boundary placement', () => {
  test('keeps a thrown MessagesView inside the message error boundary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<ChatView />);

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t be displayed/i);
    expect(screen.getByText('composer')).toBeInTheDocument();
  });
});
