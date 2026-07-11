import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { useIsMobile } from '../../hooks/useIsMobile';

export const Layout = ({ children, connected }) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-panel-bg">
        <Header connected={connected} />
        <main className="flex-1 overflow-y-auto p-3 pb-20">
          {children}
        </main>
        <MobileNav />
      </div>
    );
  }

  return (
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
};
