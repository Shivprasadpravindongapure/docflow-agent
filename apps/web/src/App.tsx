import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewApplication from './pages/NewApplication';
import ApplicationDetail from './pages/ApplicationDetail';
import ReviewerQueue from './pages/ReviewerQueue';
import ReviewerDetail from './pages/ReviewerDetail';

export default function App() {
  const [token, setToken] = useState<string | null>(null);

  function handleSignOut() {
    setToken(null);
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout token={token} onSignOut={handleSignOut} />}>
          <Route
            path="/"
            element={token ? <Navigate to="/dashboard" replace /> : <Login onLogin={setToken} />}
          />
          <Route
            path="/dashboard"
            element={token ? <Dashboard token={token} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/applications/new"
            element={token ? <NewApplication token={token} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/applications/:id"
            element={token ? <ApplicationDetail token={token} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/reviewer"
            element={token ? <ReviewerQueue token={token} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/reviewer/:id"
            element={token ? <ReviewerDetail token={token} /> : <Navigate to="/" replace />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
