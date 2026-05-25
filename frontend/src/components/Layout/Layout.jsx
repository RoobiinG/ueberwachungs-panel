import { Sidebar } from './Sidebar';
import { Header } from './Header';

export const Layout = ({ children, connected }) => (
  <div className="flex h-screen bg-panel-bg overflow-hidden">
    <Sidebar />
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header connected={connected} />
      <main className="flex-1 overflow-y-auto p-4">
        {children}
      </main>
    </div>
  </div>
);
