import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, RequireAuth, RequireTier } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Dashboard } from "./pages/Dashboard";
import { Invest, Collect } from "./pages/Market";
import { AssetDetail } from "./pages/AssetDetail";
import { Agent } from "./pages/Agent";
import { Onboarding } from "./pages/Onboarding";
import { Credentials } from "./pages/Credentials";
import { InternalAgents } from "./pages/InternalAgents";
import { AgentPermissions } from "./pages/AgentPermissions";
import { Activity } from "./pages/Activity";
import { Wallet } from "./pages/Wallet";
import { More } from "./pages/More";
import { AdminLogin } from "./pages/AdminLogin";
import { AdminConsole } from "./pages/AdminConsole";
import "./styles.css";

// Apply the persisted theme before first paint.
document.documentElement.setAttribute("data-theme", localStorage.getItem("bankai_theme") ?? "dark");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public auth */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Admin console (Phase 5A — separate token) */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminConsole />} />

            {/* Customer portal */}
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/invest" element={<Invest />} />
              <Route path="/collect" element={<Collect />} />
              <Route path="/asset/:id" element={<AssetDetail />} />
              <Route
                path="/agent"
                element={
                  <RequireTier tier={2}>
                    <Agent />
                  </RequireTier>
                }
              />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/credentials" element={<Credentials />} />
              <Route path="/agents" element={<InternalAgents />} />
              <Route path="/permissions" element={<AgentPermissions />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/more" element={<More />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
