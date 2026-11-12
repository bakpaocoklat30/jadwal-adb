import {
  Bell,
  CalendarDays,
  FileAudio,
  LayoutDashboard,
  Layers,
  LogOut,
  Settings,
  ShieldAlert
} from 'lucide-react';
import type { UserPublic } from '@jadwal-adb/shared';

export type NavTab = 'dashboard' | 'profiles' | 'calendar' | 'audio' | 'settings';

interface LayoutProps {
  user: UserPublic;
  activeTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const ROLE_LABELS: Record<UserPublic['role'], string> = {
  admin: 'Admin Jadwal',
  waka: 'Waka Kurikulum',
  piket: 'Guru Piket'
};

export function Layout({ user, activeTab, onChangeTab, onLogout, children }: LayoutProps) {
  const canManageMaster = user.role === 'admin' || user.role === 'waka';

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; visible: boolean }> = [
    {
      id: 'dashboard',
      label: 'Beranda & Kontrol',
      icon: <LayoutDashboard className="h-4 w-4" />,
      visible: true
    },
    {
      id: 'profiles',
      label: 'Profil Jadwal',
      icon: <Layers className="h-4 w-4" />,
      visible: canManageMaster
    },
    {
      id: 'calendar',
      label: 'Kalender & Mingguan',
      icon: <CalendarDays className="h-4 w-4" />,
      visible: canManageMaster
    },
    {
      id: 'audio',
      label: 'Daftar MP3 PC',
      icon: <FileAudio className="h-4 w-4" />,
      visible: true
    },
    {
      id: 'settings',
      label: 'Pengaturan',
      icon: <Settings className="h-4 w-4" />,
      visible: true
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 sm:text-base">
                Bel Sekolah ADB
              </h1>
              <p className="text-xs text-slate-500">SMK Negeri 1 Adiwerna</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-800">{user.displayName}</p>
              <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <LogOut className="h-3.5 w-3.5" />
              Keluar
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeTab(item.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition sm:text-sm ${
                    active
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-5">
        {user.mustChangePassword && (
          <div className="flex flex-col gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
              <span>
                Anda masih memakai password bawaan. Demi keamanan, segera ganti password di menu{' '}
                <strong>Pengaturan</strong>.
              </span>
            </div>
            <button
              type="button"
              onClick={() => onChangeTab('settings')}
              className="self-start rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 sm:self-auto"
            >
              Ganti Password
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
