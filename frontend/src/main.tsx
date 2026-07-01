import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, RequireAuth, RequireTier, useAuth } from "./auth/AuthContext";
import { ToastProvider } from "./components/Toast";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Welcome } from "./pages/Welcome";
import { Waitlist } from "./pages/Waitlist";
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
import { Trade } from "./pages/Trade";
import { Escrow } from "./pages/Escrow";
import { Bank } from "./pages/Bank";
import { Console } from "./pages/Console";
import { Cards } from "./pages/Cards";
import { Bills } from "./pages/Bills";
import { StarterGuardian } from "./pages/StarterGuardian";
import { StarterTeen } from "./pages/StarterTeen";
import { More } from "./pages/More";
import { AdminLogin } from "./pages/AdminLogin";
import { AdminConsole } from "./pages/AdminConsole";
import { AdminCollectibles } from "./pages/AdminCollectibles";
import { AdminApprovals } from "./pages/AdminApprovals";
import { CollectSell } from "./pages/CollectSell";
import { CollectPurchases } from "./pages/CollectPurchases";
import { Pay } from "./pages/Pay";
import { Fx } from "./pages/Fx";
import { Earn } from "./pages/Earn";
import { AddCash } from "./pages/AddCash";
import { CashOut } from "./pages/CashOut";
import { Borrow } from "./pages/Borrow";
import { Requests } from "./pages/Requests";
import { Drops } from "./pages/Drops";
import { SendAbroad } from "./pages/SendAbroad";
import { SelfCustody } from "./pages/SelfCustody";
import "./styles.css";

// Apply the persisted theme before first paint.
document.documentElement.setAttribute("data-theme", localStorage.getItem("goemon_theme") ?? "light");

/**
 * Public default at "/": the marketing homepage. Authenticated users are routed to
 * the app dashboard at /home. This is the pre-launch posture — the public sees the
 * homepage/waitlist; the team can still sign in at /login and use the app.
 */
function PublicHome() {
  const { authenticated, loading } = useAuth();
  if (loading) return null;
  return authenticated ? <Navigate to="/home" replace /> : <Welcome />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* Public marketing / pre-launch — the homepage is the public default at "/".
                Authenticated users are sent to the app dashboard at /home. */}
            <Route path="/" element={<PublicHome />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/waitlist" element={<Waitlist />} />

            {/* Public auth */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Admin console (Phase 5A — separate token) */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminConsole />} />
            <Route path="/admin/approvals" element={<AdminApprovals />} />
            <Route path="/admin/collectibles" element={<AdminCollectibles />} />

            {/* Customer portal */}
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/home" element={<Dashboard />} />
              <Route path="/invest" element={<Invest />} />
              <Route path="/collect" element={<Collect />} />
              <Route path="/collect/sell" element={<CollectSell />} />
              <Route path="/collect/purchases" element={<CollectPurchases />} />
              <Route path="/asset/:id" element={<AssetDetail />} />
              <Route
                path="/agent"
                element={
                  <RequireTier tier={2}>
                    <Agent />
                  </RequireTier>
                }
              />
              <Route
                path="/console"
                element={
                  <RequireTier tier={2}>
                    <Console />
                  </RequireTier>
                }
              />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/credentials" element={<Credentials />} />
              <Route path="/agents" element={<InternalAgents />} />
              <Route path="/permissions" element={<AgentPermissions />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/trade" element={<Trade />} />
              <Route path="/bank" element={<Bank />} />
              <Route path="/cards" element={<Cards />} />
              <Route path="/bills" element={<Bills />} />
              <Route
                path="/starter"
                element={
                  <RequireTier tier={2}>
                    <StarterGuardian />
                  </RequireTier>
                }
              />
              <Route path="/starter/teen" element={<StarterTeen />} />
              <Route path="/escrow" element={<Escrow />} />
              <Route path="/pay" element={<Pay />} />
              <Route path="/fx" element={<Fx />} />
              <Route path="/add-cash" element={<AddCash />} />
              <Route path="/cash-out" element={<CashOut />} />
              <Route path="/earn" element={<Earn />} />
              <Route path="/borrow" element={<Borrow />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/drops" element={<Drops />} />
              <Route path="/send-abroad" element={<SendAbroad />} />
              <Route path="/self-custody" element={<SelfCustody />} />
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
