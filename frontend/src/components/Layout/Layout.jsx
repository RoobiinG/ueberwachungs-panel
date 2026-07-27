import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { useIsMobile } from '../../hooks/useIsMobile';
import { UpdateLogModal } from '../UpdateLogModal';

export const Layout = ({ children, connected }) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-panel-bg">
        {/* ── New Rainbow Flag (Progress Pride) Top Accent Bar ─────────────── */}
        <div className="h-[3px] w-full bg-gradient-to-r from-[#FF0018] via-[#FFA52C] via-[#FFFF41] via-[#008018] via-[#0000F9] via-[#86007D] via-[#5BCEFA] via-[#F5A9B8] via-[#FFFFFF] via-[#613915] to-[#000000] flex-shrink-0 z-50 shadow-sm" />
        <Header connected={connected} />
        <main className="flex-1 overflow-y-auto p-3 pb-20">
          {children}
        </main>
        <MobileNav />
        <UpdateLogModal />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-panel-bg overflow-hidden">
      {/* ── New Rainbow Flag (Progress Pride) Top Accent Bar ──────────────── */}
      <div className="h-[3px] w-full bg-gradient-to-r from-[#FF0018] via-[#FFA52C] via-[#FFFF41] via-[#008018] via-[#0000F9] via-[#86007D] via-[#5BCEFA] via-[#F5A9B8] via-[#FFFFFF] via-[#613915] to-[#000000] flex-shrink-0 z-50 shadow-sm" />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header connected={connected} />
          <main className="flex-1 overflow-y-auto p-4">
            {children}
          </main>
        </div>
      </div>
      <UpdateLogModal />
    </div>
  );
};

