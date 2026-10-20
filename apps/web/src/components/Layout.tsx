import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, useApi } from '../lib/api';
import { cx, Icon, Badge, Modal, Button } from './ui';
import { ROLE } from '../lib/format';

type Item = { to: string; label: string; icon: string };

function useNav(): Item[] {
  const { isSuperAdmin, isCampusAdmin, isAdvisor, isTreasurer, isLead } = useAuth();

  const home = { to: '/', label: 'Dashboard', icon: 'home' };
  const clubs = {
    to: '/clubs',
    label: isSuperAdmin || isCampusAdmin ? 'Clubs' : 'My Club',
    icon: 'users',
  };
  const days = { to: '/club-days', label: 'Club Days', icon: 'calendar' };
  const checkin = { to: '/checkin', label: 'Check in', icon: 'qr' };
  const events = { to: '/events', label: 'Events', icon: 'flag' };
  const certs = { to: '/certificates', label: 'Certificates', icon: 'award' };
  const dash = { to: '/dashboard', label: 'Analytics', icon: 'chart' };
  const reports = { to: '/reports', label: 'Reports', icon: 'clip' };
  const budget = { to: '/budget', label: 'Budget Approvals', icon: 'wallet' };
  const duty = { to: '/duty-leave', label: 'Duty Leave', icon: 'send' };
  const transcript = { to: '/transcript', label: 'Transcript', icon: 'file' };
  const admin = { to: '/admin', label: 'Administration', icon: 'shield' };

  if (isSuperAdmin) {
    return [home, clubs, budget, dash, days, events, reports, duty, admin];
  }
  if (isCampusAdmin) {
    return [home, clubs, budget, days, events, reports, duty, admin];
  }
  if (isAdvisor) {
    return [home, clubs, budget, days, events, reports, certs];
  }
  if (isTreasurer) {
    return [home, clubs, budget, days, checkin, events, certs, transcript];
  }
  // Student / Member
  return [home, clubs, ...(isLead ? [budget] : []), days, checkin, events, certs, transcript, duty];
}

export default function Layout() {
  const {
    me,
    logout,
    login,
    positionLabel,
    refresh,
    isSuperAdmin,
    isCampusAdmin,
    selectedCampusId,
    setSelectedCampusId,
  } = useAuth();
  const nav = useNav();
  const [more, setMore] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const loc = useLocation();
  const go = useNavigate();
  const demoAccounts = useApi<any>('/public/demo-accounts');

  useEffect(() => setMore(false), [loc.pathname]);
  useEffect(() => {
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  const unread = me?.unread || 0;
  const bar = nav.slice(0, 4), rest = nav.slice(4);

  const switchAccount = async (acc: any) => {
    try {
      const res = await api<any>('/auth/login', {
        body: { identifier: acc.email, password: demoAccounts.data?.password || 'Demo@123' },
        auth: false,
      });
      if (res?.token) {
        await login(res.token);
        setShowDemoModal(false);
        go('/');
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const link = (i: Item, mobile = false) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === '/'}
      className={({ isActive }) =>
        mobile
          ? cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', isActive ? 'text-brand' : 'text-ink-60')
          : cx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
              isActive
                ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#E39B0B]'
                : 'text-white/70 hover:bg-white/5 hover:text-white'
            )
      }
    >
      <Icon name={i.icon} size={mobile ? 22 : 18} />
      {i.label}
    </NavLink>
  );

  const bell = (
    <button
      onClick={() => go('/notifications')}
      aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      className="relative flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-white border border-transparent hover:border-line"
    >
      <Icon name="bell" />
      {unread > 0 && (
        <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-saffron px-1 text-center text-[10px] font-bold leading-[18px] text-ink">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );

  const allCampuses = me?.all_campuses || [];

  return (
    <div className="min-h-screen md:flex bg-paper">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-ink p-4 text-white md:flex shadow-xl">
        <div className="mb-4 flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="CampusCred" className="h-9 w-9 rounded-xl object-cover" />
            <div>
              <span className="font-display text-lg font-bold tracking-tight">CampusCred</span>
              <span className="block text-[10px] text-white/50 uppercase tracking-widest font-mono">Multi-Campus</span>
            </div>
          </div>
        </div>

        {/* Super Admin Campus Switcher in Sidebar */}
        {isSuperAdmin && allCampuses.length > 0 && (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-white/60 mb-1.5 font-medium">
              <span>Campus Scope:</span>
              <span className="text-[10px] bg-brand/40 text-brand-tint px-1.5 py-0.5 rounded font-mono font-semibold">Super Admin</span>
            </div>
            <select
              aria-label="Select Campus Scope"
              value={selectedCampusId ?? ''}
              onChange={(e) => setSelectedCampusId(e.target.value ? Number(e.target.value) : null)}
              style={{ colorScheme: 'dark', backgroundColor: '#183640', color: '#ffffff' }}
              className="w-full rounded-lg bg-[#183640] border border-white/20 text-xs text-white px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-brand font-medium cursor-pointer"
            >
              <option value="" style={{ backgroundColor: '#10242B', color: '#ffffff' }}>All Campuses (Consolidated)</option>
              {allCampuses.map((c) => (
                <option key={c.id} value={c.id} style={{ backgroundColor: '#10242B', color: '#ffffff' }}>
                  {c.name} ({c.city})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Campus Admin Badge */}
        {isCampusAdmin && me?.campus && (
          <div className="mb-4 rounded-xl border border-brand/30 bg-brand/10 p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-brand-tint font-bold">Assigned Campus</p>
            <p className="text-xs font-semibold text-white truncate">{me.campus.name}</p>
            <p className="text-[11px] text-white/60">{me.campus.city}</p>
          </div>
        )}

        {/* Navigation Links */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1" aria-label="Main">
          {nav.map((i) => link(i))}
        </nav>

        {/* User Card & Demo Switcher */}
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="rounded-lg bg-white/5 p-2 mb-2">
            <p className="truncate text-sm font-semibold text-white">{me?.user.name}</p>
            <p className="truncate text-xs text-brand-tint font-medium">{positionLabel}</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/10 py-2 px-3 text-xs font-semibold text-white/80 hover:bg-danger/20 hover:text-danger hover:border-danger/30 transition-colors"
              title="Sign out"
            >
              <Icon name="logout" size={15} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 flex-1 flex flex-col">
        {/* Top Header */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-paper/95 px-4 md:px-8 py-2.5 backdrop-blur shadow-xs"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 md:hidden">
              <img src="/logo.png" alt="CampusCred" className="h-7 w-7 rounded-lg object-cover" />
              <span className="font-display text-base font-bold">CampusCred</span>
            </div>

            {/* Scope breadcrumb / banner */}
            <div className="hidden sm:flex items-center gap-2 text-xs text-ink-60 font-medium">
              <span>Environment:</span>
              {isSuperAdmin ? (
                selectedCampusId ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-sunken px-2.5 py-0.5 font-semibold text-brand border border-brand/20">
                    <Icon name="campus" size={13} />
                    <span>{allCampuses.find((c) => c.id === selectedCampusId)?.name || 'Campus Filtered'}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-sunken px-2.5 py-0.5 font-semibold text-ink border border-line">
                    <Icon name="globe" size={13} />
                    <span>Consolidated (All Campuses)</span>
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-sunken px-2.5 py-0.5 font-semibold text-ink border border-line">
                  <Icon name="campus" size={13} />
                  <span>{me?.campus?.name || 'My Campus'}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {bell}
          </div>
        </header>

        {/* Content Outlet */}
        <main className="mx-auto w-full max-w-6xl p-4 pb-28 md:p-8 md:pb-12 flex-1">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-white/95 backdrop-blur-md md:hidden shadow-lg">
        {bar.map((i) => link(i, true))}
        <button
          onClick={() => setMore(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-ink-60 hover:text-brand transition-colors"
        >
          <Icon name="more" size={22} />
          More
        </button>
      </nav>

      {/* Mobile More Drawer */}
      {more && (
        <div
          className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-xs md:hidden transition-opacity"
          onClick={() => setMore(false)}
        >
          <div
            className="safe-bottom absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl animate-in slide-in-from-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3 mb-3">
              <div className="min-w-0 pr-2">
                <p className="font-semibold text-ink truncate text-sm">{me?.user.name}</p>
                <p className="text-xs text-brand font-medium truncate">{positionLabel}</p>
              </div>
              <button
                onClick={() => setMore(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-paper text-ink-60 hover:bg-paper-sunken text-lg"
                aria-label="Close drawer"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {rest.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  onClick={() => setMore(false)}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-line p-3 text-xs font-semibold text-ink hover:border-brand hover:bg-brand-sunken/40 transition-all text-center"
                >
                  <Icon name={i.icon} size={20} />
                  <span className="truncate max-w-full">{i.label}</span>
                </NavLink>
              ))}
              <NavLink
                to="/notifications"
                onClick={() => setMore(false)}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-line p-3 text-xs font-semibold text-ink hover:border-brand transition-all text-center"
              >
                <Icon name="bell" size={20} />
                <span>Alerts</span>
              </NavLink>
              <button
                onClick={logout}
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-danger/20 bg-danger-tint/20 p-3 text-xs font-semibold text-danger hover:bg-danger-tint transition-all text-center"
              >
                <Icon name="logout" size={20} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role Switcher Modal */}
      {showDemoModal && (
        <Modal title="Role Switcher (Institutional Access Control)" onClose={() => setShowDemoModal(false)}>
          <p className="text-xs text-ink-60 mb-3">
            Select any registered account to view their dashboard experience and permissions:
          </p>
          <div className="max-h-[65vh] overflow-y-auto space-y-2 pr-1">
            {demoAccounts.data?.accounts ? (
              demoAccounts.data.accounts.map((a: any) => {
                const isCurrent = me?.user.id === a.id;
                let roleBadgeTone: 'brand' | 'warn' | 'ok' | 'neutral' = 'neutral';
                if (a.system_role === 'super_admin' || a.system_role === 'admin') roleBadgeTone = 'brand';
                else if (a.system_role === 'campus_admin' || a.system_role === 'campus_manager') roleBadgeTone = 'ok';
                else if (a.system_role === 'faculty_advisor' || a.system_role === 'advisor') roleBadgeTone = 'warn';

                return (
                  <button
                    key={a.id}
                    onClick={() => switchAccount(a)}
                    disabled={isCurrent}
                    className={cx(
                      'w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between',
                      isCurrent
                        ? 'border-brand bg-brand-sunken opacity-80 cursor-default'
                        : 'border-line bg-white hover:border-brand hover:shadow-sm'
                    )}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-ink">{a.name}</span>
                        {isCurrent && <span className="text-[10px] font-bold text-brand bg-brand/10 px-1.5 py-0.5 rounded">Active</span>}
                      </div>
                      <p className="text-xs text-ink-60">
                        {a.email} · {a.campus_name || 'All Campuses'}
                      </p>
                      {a.club && (
                        <p className="text-[11px] text-ink-80 font-medium">
                          Club: {a.club} ({a.position || 'member'})
                        </p>
                      )}
                    </div>
                    <Badge tone={roleBadgeTone}>{ROLE[a.system_role] || a.system_role}</Badge>
                  </button>
                );
              })
            ) : (
              <p className="text-sm text-ink-60">Loading available accounts...</p>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setShowDemoModal(false)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
