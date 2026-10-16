import { Link, Outlet, useNavigate } from 'react-router-dom';

interface LayoutProps {
  token: string | null;
  onSignOut: () => void;
}

export default function Layout({ token, onSignOut }: LayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-lg font-bold tracking-tight text-sky-800">
              DocFlow
            </Link>
            {token && (
              <div className="hidden items-center gap-1 sm:flex">
                <Link
                  to="/dashboard"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  Dashboard
                </Link>
                <Link
                  to="/applications/new"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  New Application
                </Link>
                <Link
                  to="/reviewer"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  Reviewer
                </Link>
              </div>
            )}
          </div>
          {token && (
            <button
              onClick={() => { onSignOut(); navigate('/'); }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Sign out
            </button>
          )}
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-500 sm:px-6">
        DocFlow — Development preview. Use synthetic data only.
      </footer>
    </div>
  );
}
